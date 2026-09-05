import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  IMPLEMENTED_PROVIDERS,
  availableActions,
  calendarCapabilities,
  canTransition,
  isIntegrationUsable,
  isProviderImplemented,
  unusableReason,
} from "../lib/integrations/connectionState.ts";
import type { IntegrationStatus } from "../types/integrations.ts";

/**
 * HERMÈS — Connexions self-service : isolation, non-exposition des secrets,
 * fail-closed.
 *
 * LIMITE HONNÊTE : ces tests prouvent le SCHÉMA et la LOGIQUE DE DÉCISION.
 * Ils ne prouvent pas un flux OAuth réel — aucun n'a été exécuté
 * (GOOGLE_OAUTH_LIVE = NO), et le bouclage dépend de n8n, indisponible.
 */

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const CONNECTIONS = read("../db/migrations/20260819_hermes_integrations_1_connections.sql");
const PROVISIONING = read("../db/migrations/20260819_hermes_integrations_2_phone_provisioning.sql");
const PHONE = read("../db/migrations/20260819_photo_studio_7_phone.sql");

const NOW = new Date("2026-08-19T12:00:00Z");
const ALL_STATUSES: IntegrationStatus[] = [
  "NOT_CONNECTED", "CONNECTING", "CONNECTED", "ERROR", "REAUTH_REQUIRED", "REVOKED",
];

/** Retire commentaires `--` ET `comment on … ;` : sinon le test se déclenche
 *  sur sa propre documentation, qui parle justement de secrets. */
const executable = (sql: string): string =>
  sql
    .replace(/comment on [\s\S]*?;/gi, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

// --- Aucun jeton exposé -------------------------------------------------------
/**
 * Extrait les NOMS DE COLONNES des blocs `create table`.
 *
 * On ne peut pas se contenter de chercher le mot dans tout le fichier : l'URL
 * publique d'échange de Meta se termine littéralement par `/oauth/access_token`.
 * Ce qui compte n'est pas qu'un mot apparaisse, mais qu'une COLONNE porte un
 * secret — c'est cela qu'on vérifie.
 */
function columnNames(sql: string): string[] {
  const names: string[] = [];
  for (const m of executable(sql).matchAll(/create table if not exists [\w.]+ \(([\s\S]*?)\n\);/g)) {
    for (const line of m[1].split("\n")) {
      const col = /^\s{2}([a-z_][a-z0-9_]*)\s+\S/.exec(line);
      if (col && !["primary", "constraint", "check", "foreign", "unique"].includes(col[1])) {
        names.push(col[1]);
      }
    }
  }
  return names;
}

test("aucun jeton OAuth n'est stocké en base — seulement un pointeur Vault", () => {
  const cols = columnNames(CONNECTIONS);
  assert.ok(cols.length > 10, `parseur de colonnes cassé (${cols.length} colonnes)`);
  // Recherche par SOUS-CHAÎNE sur le NOM : `\baccess_token\b` ne matcherait
  // pas `google_access_token`, « _ » étant un caractère de mot.
  for (const forbidden of [
    "access_token", "refresh_token", "id_token", "client_secret",
    "api_key", "apikey", "password", "bearer", "token_value",
  ]) {
    const offender = cols.find((c) => c.includes(forbidden));
    assert.equal(offender, undefined, `colonne interdite : ${offender} (${forbidden})`);
  }
  // Le seul lien vers le secret est un UUID opaque.
  assert.ok(cols.includes("vault_secret_id"), "le pointeur Vault doit exister");
});

test("la façade de lecture ne projette JAMAIS le pointeur Vault", () => {
  const start = CONNECTIONS.indexOf("create or replace function public.get_tenant_integrations");
  const end = CONNECTIONS.indexOf("revoke all on function public.get_tenant_integrations");
  const body = CONNECTIONS.slice(start, end);
  assert.ok(start !== -1 && end > start);
  assert.ok(
    !body.includes("'vault_secret_id'"),
    "vault_secret_id ne doit pas figurer dans la projection JSON",
  );
  // Et le type TypeScript ne le porte pas non plus : ce qui n'existe pas ne fuit pas.
  const types = read("../types/integrations.ts");
  assert.ok(!types.includes("vaultSecretId"));
  assert.ok(!types.toLowerCase().includes("accesstoken"));
});

test("le `state` est stocké en EMPREINTE, jamais en clair", () => {
  assert.ok(CONNECTIONS.includes("state_hash    text primary key"));
  assert.ok(CONNECTIONS.includes("encode(sha256(convert_to(v_state, 'UTF8')), 'hex')"));
  // La colonne `state` en clair n'existe pas.
  assert.ok(!executable(CONNECTIONS).includes("state         text not null"));
});

// --- Isolation tenant -----------------------------------------------------------
test("tenant A ne peut jamais voir la connexion de tenant B", () => {
  const sql = executable(CONNECTIONS);
  // 1. RLS deny-all sur les 3 tables.
  assert.equal((sql.match(/enable row level security/g) ?? []).length, 3);
  assert.ok(!/create policy/i.test(sql), "aucune policy : la table est deny-all");
  // 2. La clé primaire est (tenant_id, provider) : pas de ligne partagée.
  assert.ok(sql.includes("primary key (tenant_id, provider)"));
  // 3. Le tenant est résolu SERVER-SIDE, jamais reçu du client.
  assert.ok(sql.includes("hermes_os.resolve_active_tenant(null)"));
  // 4. Aucune façade publique n'accepte de tenant en PARAMÈTRE.
  //    On inspecte la liste d'arguments seule : le NOM `get_tenant_integrations`
  //    contient « tenant », ce qui est sans rapport avec ce qu'il reçoit.
  for (const [fn, args] of [
    ["public.get_tenant_integrations", "()"],
    ["public.begin_integration_connection", "(text, text)"],
    ["public.revoke_integration_connection", "(text)"],
  ] as const) {
    assert.ok(
      sql.includes(`grant execute on function ${fn}${args} to authenticated`),
      `${fn} doit être accordée à authenticated`,
    );
    assert.ok(!/tenant/i.test(args), `${fn} ne doit pas prendre de tenant du client`);
  }
  // Les paramètres déclarés ne comportent aucun `p_tenant`.
  assert.ok(
    !/create or replace function public\.\w+\([^)]*p_tenant/.test(sql),
    "aucune façade publique ne déclare p_tenant",
  );
});

test("les DEUX voies de finalisation ont chacune la bonne portée", () => {
  // La voie n8n reste réservée à `service_role` : elle reçoit un `vault_secret_id`
  // DÉJÀ écrit, donc quiconque l'appelle a forcément accès à Vault.
  assert.ok(
    CONNECTIONS.includes(
      "grant execute on function hermes_os.complete_integration_connection(text, uuid, text, text[], timestamptz) to service_role",
    ),
  );
  assert.ok(
    !/hermes_os\.complete_integration_connection\(text, uuid, text, text\[\], timestamptz\) to authenticated/.test(
      CONNECTIONS,
    ),
    "la variante service_role ne doit jamais être accordée à authenticated",
  );

  // La voie ROUTE SERVEUR est accordée à `authenticated` — c'est délibéré, et
  // c'est ce qui permet au callback Next.js de boucler SANS clé service_role.
  // Elle ne reçoit jamais de pointeur Vault : elle l'écrit elle-même, en
  // SECURITY DEFINER. Son audit détaillé vit dans tests/oauth-server-route.
  assert.ok(
    CONNECTIONS.includes(`grant execute on function public.complete_integration_connection_self(
  text, text, text, timestamptz, text, text[]) to authenticated;`),
  );
  const self = CONNECTIONS.slice(
    CONNECTIONS.indexOf("function public.complete_integration_connection_self"),
    CONNECTIONS.indexOf("revoke all on function public.complete_integration_connection_self"),
  );
  // Aucun pointeur Vault ne peut ENTRER par cette voie…
  assert.ok(!/p_vault_secret_id|p_secret_id/i.test(self), "un pointeur Vault entre en paramètre");
  // …ni en SORTIR.
  const ret = self.slice(self.lastIndexOf("return jsonb_build_object"));
  assert.ok(!ret.includes("vault_secret_id"), "un pointeur Vault sort vers le navigateur");
});

test("le `state` est à usage unique : un rejeu du callback échoue", () => {
  assert.ok(
    CONNECTIONS.includes("where state_hash = v_hash and consumed_at is null and expires_at > now()"),
    "la consommation doit être atomique et bornée dans le temps",
  );
});

// --- Fail-closed ------------------------------------------------------------------
test("seul CONNECTED est utilisable — les 5 autres états refusent", () => {
  for (const status of ALL_STATUSES) {
    const usable = isIntegrationUsable({ status, expiresAt: null }, NOW);
    assert.equal(usable, status === "CONNECTED", `${status} mal évalué`);
  }
});

test("un jeton expiré ne vaut pas mieux qu'une absence de jeton", () => {
  const expired = { status: "CONNECTED" as const, expiresAt: "2026-08-19T11:59:00Z" };
  const valid = { status: "CONNECTED" as const, expiresAt: "2026-08-19T12:01:00Z" };
  assert.equal(isIntegrationUsable(expired, NOW), false);
  assert.equal(isIntegrationUsable(valid, NOW), true);
  assert.equal(unusableReason(expired, NOW), "EXPIRED");
});

test("une date d'expiration illisible REFUSE — on ne devine pas une validité", () => {
  assert.equal(
    isIntegrationUsable({ status: "CONNECTED", expiresAt: "n'importe quoi" }, NOW),
    false,
  );
});

test("connexion révoquée → fail closed, et pas de retour direct à CONNECTED", () => {
  assert.equal(isIntegrationUsable({ status: "REVOKED", expiresAt: null }, NOW), false);
  assert.equal(canTransition("REVOKED", "CONNECTED"), false, "il faut repasser par OAuth");
  assert.equal(canTransition("REVOKED", "CONNECTING"), true);
  assert.equal(canTransition("REAUTH_REQUIRED", "CONNECTED"), false);
  // En base aussi : la révocation efface le pointeur DANS la même requête.
  assert.ok(CONNECTIONS.includes("status = 'REVOKED'"));
  assert.ok(CONNECTIONS.includes("vault_secret_id = null"));
});

test("un statut CONNECTED sans pointeur Vault est interdit par contrainte", () => {
  assert.ok(CONNECTIONS.includes("constraint integration_connected_has_secret"));
  assert.ok(CONNECTIONS.includes("check (status <> 'CONNECTED' or vault_secret_id is not null)"));
});

// --- Capacités agenda ---------------------------------------------------------------
test("Calendar non connecté → aucune disponibilité, mais le standard reste utile", () => {
  const caps = calendarCapabilities({ connection: null, lookupAllowed: true, now: NOW });
  assert.equal(caps.canReadAvailability, false);
  assert.equal(caps.canProposeSlot, false);
  assert.equal(caps.canConfirmBooking, false);
  // Ce qui ne doit JAMAIS être dégradé :
  assert.equal(caps.canAnswerCall, true);
  assert.equal(caps.canQualify, true);
  assert.equal(caps.canCreateLead, true);
  assert.equal(caps.canOfferCallback, true);
});

test("Calendar connecté ET autorisé → lecture et proposition de créneau", () => {
  const caps = calendarCapabilities({
    connection: { status: "CONNECTED", expiresAt: null },
    lookupAllowed: true,
    now: NOW,
  });
  assert.equal(caps.canReadAvailability, true);
  assert.equal(caps.canProposeSlot, true);
});

test("connecté mais NON autorisé par la photographe → toujours refusé", () => {
  const caps = calendarCapabilities({
    connection: { status: "CONNECTED", expiresAt: null },
    lookupAllowed: false,
    now: NOW,
  });
  assert.equal(caps.canReadAvailability, false, "il faut les DEUX conditions");
});

test("la réservation ferme reste soumise aux approbations, même avec agenda", () => {
  const caps = calendarCapabilities({
    connection: { status: "CONNECTED", expiresAt: null },
    lookupAllowed: true,
    now: NOW,
  });
  assert.equal(caps.canConfirmBooking, false, "l'agent n'engage jamais seul le studio");
});

test("les actions offertes à l'écran suivent l'état", () => {
  assert.deepEqual(availableActions("NOT_CONNECTED"), ["CONNECT"]);
  assert.deepEqual(availableActions("CONNECTED"), ["REVOKE"]);
  assert.deepEqual(availableActions("REVOKED"), ["RECONNECT"]);
  assert.deepEqual(availableActions("CONNECTING"), ["WAIT"], "pas de double clic");
});

// --- Retell reste Hermès-managed -------------------------------------------------
test("aucun secret Retell dans une table métier ni de configuration tenant", () => {
  for (const [name, sql] of [["provisioning", PROVISIONING], ["phone_config", PHONE]] as const) {
    const body = executable(sql);
    for (const forbidden of [
      "api_key", "apikey", "secret_key", "access_token", "client_secret", "password", "bearer",
    ]) {
      assert.ok(
        !body.toLowerCase().includes(forbidden),
        `${name} : ${forbidden} interdit — la clé Retell appartient à Hermès`,
      );
    }
  }
});

test("la table de provisionnement n'est JAMAIS exposée au tenant", () => {
  // Aucune façade `authenticated` ne lit phone_provisioning directement, et la
  // façade de statut ne renvoie ni l'agent ni le pointeur Vault.
  const start = PROVISIONING.indexOf("create or replace function public.get_phone_status");
  const body = PROVISIONING.slice(start, PROVISIONING.indexOf("revoke all on function public.get_phone_status"));
  assert.ok(!body.includes("external_agent_ref"), "l'agent Retell ne doit pas sortir");
  assert.ok(!body.includes("vault_secret_id"), "le pointeur Vault ne doit pas sortir");
  assert.ok(body.includes("number_e164"), "son propre numéro lui est utile");
});

test("le standard exige LES DEUX faces : config tenant ET provisionnement Hermès", () => {
  assert.ok(PROVISIONING.includes("coalesce(v_cfg, false) and coalesce(v_prov, false)"));
  assert.ok(PROVISIONING.includes("'NOT_PROVISIONED_BY_HERMES'"));
  assert.ok(PROVISIONING.includes("'TENANT_PHONE_DISABLED'"));
  // Un provisionnement READY incomplet est interdit par contrainte.
  assert.ok(PROVISIONING.includes("constraint phone_provisioning_ready_complete"));
});

// --- Coûts ---------------------------------------------------------------------------
test("coûts séparés par tenant, et jamais une estimation enregistrée comme réelle", () => {
  assert.ok(PROVISIONING.includes("where tenant_id = p_tenant"), "agrégat borné au tenant");
  // Seuls les appels réellement facturés alimentent les montants.
  assert.ok(PROVISIONING.includes("filter (where cost_reported)"));
  // L'écart est rendu visible plutôt qu'absorbé.
  assert.ok(PROVISIONING.includes("'calls_without_reported_cost', v_no_cost"));
  // Provenance honnête sur trois niveaux.
  for (const p of ["'REAL'", "'PARTIAL'", "'UNAVAILABLE'"]) {
    assert.ok(PROVISIONING.includes(p), `provenance ${p} attendue`);
  }
});

test("la ventilation des coûts existe et reste NULL quand non rapportée", () => {
  for (const col of ["retell_cost_usd", "telephony_cost_usd", "llm_cost_usd"]) {
    assert.ok(PHONE.includes(col), `colonne ${col} attendue`);
    // Aucune de ces colonnes n'a de `default 0`, qui fabriquerait un faux coût.
    assert.ok(
      !new RegExp(`${col}[^,]*default 0`).test(PHONE),
      `${col} ne doit pas avoir de défaut 0`,
    );
  }
  assert.ok(PHONE.includes("cost_reported      boolean not null default false"));
});

// --- Généricité sans surarchitecture ----------------------------------------------
test("l'architecture est générique et seuls Google Calendar et Qonto sont implémentés", () => {
  for (const p of ["google_calendar", "gmail", "meta", "instagram"]) {
    assert.ok(CONNECTIONS.includes(`'${p}'`), `${p} doit être déclaré au catalogue`);
  }
  assert.deepEqual([...IMPLEMENTED_PROVIDERS], ["google_calendar", "qonto"]);
  assert.equal(isProviderImplemented("google_calendar"), true);
  assert.equal(isProviderImplemented("qonto"), true);
  assert.equal(isProviderImplemented("gmail"), false, "déclaré n'est pas implémenté");
});

test("aucun fournisseur n'est joignable tant qu'Hermès ne l'a pas provisionné", () => {
  // Catalogue seedé DÉSACTIVÉ et sans client_id.
  assert.ok(CONNECTIONS.includes("array['https://www.googleapis.com/auth/calendar.readonly'], false, 10"));
  // Et la façade refuse explicitement un fournisseur sans client_id.
  assert.ok(CONNECTIONS.includes("'PROVIDER_NOT_PROVISIONED'"));
  assert.ok(CONNECTIONS.includes("'PROVIDER_UNAVAILABLE'"));
});
