import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import {
  OAUTH_SERVER_PROVIDERS,
  callbackUrl,
  isOAuthServerProvider,
  parseTokenPayload,
  safeRedirectPath,
} from "../lib/integrations/oauth.ts";

/**
 * HERMÈS — OAuth par route serveur Next.js.
 *
 * La décision « callback dans Next.js » n'était acceptable que sous une
 * condition stricte : ne JAMAIS introduire la clé `service_role` dans
 * l'application. Ces tests vérifient cette condition, et auditent point par
 * point la façade `authenticated` qui la rend possible.
 */

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "").replace(/\/\/.*$/gm, "");

const MIGRATION = read("db/migrations/20260819_hermes_integrations_1_connections.sql");
const SELF_FN = MIGRATION.slice(
  MIGRATION.indexOf("function public.complete_integration_connection_self"),
  MIGRATION.indexOf("revoke all on function public.complete_integration_connection_self"),
);

// ═══ LA CONDITION STRICTE ════════════════════════════════════════════════════

test("AUCUNE clé service_role nulle part dans le code de l'application", () => {
  const roots = ["app", "lib", "services", "components"];
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(new URL(`../${dir}`, import.meta.url), {
      withFileTypes: true,
    })) {
      const p = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const src = stripComments(read(p)).toLowerCase();
        if (src.includes("service_role") || src.includes("service-role")) offenders.push(p);
      }
    }
  };
  for (const r of roots) walk(r);
  assert.deepEqual(offenders, [], `service_role référencé dans : ${offenders.join(", ")}`);
});

test("aucun secret n'est préfixé NEXT_PUBLIC_", () => {
  // On inspecte les DÉCLARATIONS, pas les mentions : `.env.example` nomme
  // volontairement les variables interdites dans un bloc d'avertissement, et
  // une recherche de texte brut prendrait cet avertissement pour la faute.
  const declarations = read(".env.example")
    .split("\n")
    .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l.trim()))
    .map((l) => l.trim().split("=")[0]);

  for (const name of declarations) {
    if (!name.startsWith("NEXT_PUBLIC_")) continue;
    assert.ok(
      !/SECRET|SERVICE_ROLE|PRIVATE|PASSWORD/i.test(name),
      `variable publique suspecte : ${name}`,
    );
  }
  assert.ok(declarations.includes("GOOGLE_CLIENT_SECRET"), "secret serveur non documenté");
  assert.ok(!declarations.includes("NEXT_PUBLIC_GOOGLE_CLIENT_SECRET"));
  assert.ok(!declarations.includes("SUPABASE_SERVICE_ROLE_KEY"));
  // …et l'avertissement doit bien être présent, lui.
  assert.ok(read(".env.example").includes("SUPABASE_SERVICE_ROLE_KEY"),
    "l'interdiction doit rester écrite noir sur blanc");
});

test("le module qui touche le secret est `server-only`, vérifié à la compilation", () => {
  const src = read("lib/integrations/oauthServer.ts");
  assert.ok(src.trimStart().startsWith('import "server-only";'));
  assert.ok(src.includes("process.env[SECRET_ENV[provider]]"));
  // Le secret n'est jamais capturé au chargement : relu à chaque appel.
  assert.ok(!/const\s+\w*SECRET\w*\s*=\s*process\.env/.test(src));
});

test("la frontière server-only est SERRÉE : la partie pure n'en porte pas", () => {
  // Ce test a une histoire : le runner ne pouvait pas charger le module, parce
  // que `server-only` lève à l'import hors bundle Next.js. C'était la barrière
  // qui fonctionnait — mais elle enfermait aussi des fonctions sans secret,
  // donc non éprouvées. Elles vivent désormais à côté, et sont testées.
  const pure = stripComments(read("lib/integrations/oauth.ts"));
  assert.ok(!pure.includes('import "server-only"'));
  assert.ok(!pure.includes("process.env"), "la partie pure ne lit aucun secret");
  assert.ok(!pure.includes("fetch("), "la partie pure ne fait aucun appel réseau");
  assert.ok(pure.includes("export function parseTokenPayload"));
  assert.ok(pure.includes("export function safeRedirectPath"));
});

// ═══ AUDIT DE LA FAÇADE `authenticated` ══════════════════════════════════════

test("la façade est SECURITY DEFINER et accordée à `authenticated`, pas à public", () => {
  assert.ok(SELF_FN.includes("security definer"));
  assert.ok(SELF_FN.includes("set search_path to 'hermes_os', 'pg_catalog', 'pg_temp'"));
  assert.ok(
    MIGRATION.includes(`revoke all on function public.complete_integration_connection_self(
  text, text, text, timestamptz, text, text[]) from public;`),
  );
  assert.ok(
    MIGRATION.includes(`grant execute on function public.complete_integration_connection_self(
  text, text, text, timestamptz, text, text[]) to authenticated;`),
  );
});

test("1. l'appel anonyme est refusé avant tout", () => {
  assert.ok(SELF_FN.includes("v_uid uuid := auth.uid()"));
  const uidCheck = SELF_FN.indexOf("if v_uid is null then");
  const stateUse = SELF_FN.indexOf("update hermes_os.tenant_integration_oauth_states");
  assert.ok(uidCheck > 0 && uidCheck < stateUse, "le state est touché avant l'authentification");
});

test("2. le state est consommé ATOMIQUEMENT — un rejeu ne trouve rien", () => {
  const consume = SELF_FN.slice(
    SELF_FN.indexOf("update hermes_os.tenant_integration_oauth_states"),
    SELF_FN.indexOf("if not found then"),
  );
  assert.ok(consume.includes("set consumed_at = now()"));
  assert.ok(consume.includes("and consumed_at is null"), "condition d'unicité hors de l'UPDATE");
  assert.ok(consume.includes("and expires_at > now()"), "un state expiré resterait utilisable");
  assert.ok(consume.includes("returning * into v_state"), "lecture-puis-écriture = course");
  // Aucun SELECT préalable sur la table : ce serait la faille classique.
  assert.ok(
    !/select[\s\S]*from hermes_os\.tenant_integration_oauth_states/.test(
      SELF_FN.slice(0, SELF_FN.indexOf("update hermes_os.tenant_integration_oauth_states")),
    ),
    "un SELECT précède la consommation",
  );
});

test("2 bis. rejeu, expiration et state inconnu renvoient le MÊME code", () => {
  // Distinguer les trois cas aiderait surtout quelqu'un qui sonde.
  assert.equal((SELF_FN.match(/'STATE_INVALID'/g) ?? []).length, 1);
});

test("3. seul l'utilisateur qui a démarré le flux peut le terminer", () => {
  assert.ok(SELF_FN.includes("v_state.requested_by is distinct from v_uid"));
  assert.ok(SELF_FN.includes("'STATE_NOT_YOURS'"));
});

test("4. le tenant_id ne peut PAS venir du client — la signature l'interdit", () => {
  const signature = MIGRATION.slice(
    MIGRATION.indexOf("create or replace function public.complete_integration_connection_self"),
    MIGRATION.indexOf("returns jsonb", MIGRATION.indexOf("complete_integration_connection_self")),
  );
  assert.ok(!/p_tenant/i.test(signature), "un paramètre de tenant existe");
  // Il est lu dans la ligne de state, écrite côté serveur au démarrage.
  assert.ok(SELF_FN.includes("v_state.tenant_id"));
});

test("5. le fournisseur est REVÉRIFIÉ à la fin, pas seulement au début", () => {
  assert.ok(SELF_FN.includes("hermes_os.tenant_allows_provider(v_state.tenant_id, v_state.provider)"));
  const check = SELF_FN.indexOf("tenant_allows_provider");
  const vault = SELF_FN.indexOf("vault.create_secret");
  assert.ok(check < vault, "le secret est écrit avant la vérification du fournisseur");
});

test("6. le jeton va dans Vault, jamais dans une colonne", () => {
  assert.ok(SELF_FN.includes("vault.create_secret("));
  assert.ok(SELF_FN.includes("vault_secret_id = v_secret_id"));
  const code = stripComments(SELF_FN);
  assert.ok(!/access_token\s*=/.test(code), "un jeton serait écrit en colonne");
});

test("7. le retour ne contient NI jeton NI pointeur Vault", () => {
  const ret = SELF_FN.slice(SELF_FN.lastIndexOf("return jsonb_build_object"));
  for (const leak of ["vault_secret_id", "access_token", "refresh_token", "v_secret_id"]) {
    assert.ok(!ret.includes(leak), `le retour expose ${leak}`);
  }
  assert.ok(ret.includes("'provider'") && ret.includes("'redirect_after'"));
});

// ═══ FILTRE D'INTÉGRATIONS EN BASE ═══════════════════════════════════════════

test("la base applique le filtre par verticale — plus seulement l'interface", () => {
  assert.ok(MIGRATION.includes("function hermes_os.tenant_allows_provider("));
  // Les trois portes : lecture, démarrage, complétion.
  assert.ok(MIGRATION.includes("and hermes_os.tenant_allows_provider(v_t, p.provider)"));
  assert.ok(MIGRATION.includes("if not hermes_os.tenant_allows_provider(v_t, p_provider) then"));
  assert.ok(SELF_FN.includes("tenant_allows_provider(v_state.tenant_id"));
  assert.ok(MIGRATION.includes("'PROVIDER_NOT_ALLOWED_FOR_VERTICAL'"));
});

test("le filtre est FAIL-CLOSED : verticale inconnue ⇒ aucun fournisseur", () => {
  const fn = MIGRATION.slice(
    MIGRATION.indexOf("function hermes_os.tenant_allows_provider"),
    MIGRATION.indexOf("revoke all on function hermes_os.tenant_allows_provider"),
  );
  assert.ok(fn.includes("t.vertical is not null"), "une verticale NULL autoriserait tout");
  assert.ok(fn.includes("t.vertical = any (p.verticals)"));
  assert.ok(fn.includes("p.enabled"));
});

test("le catalogue porte ses verticales, vides par défaut", () => {
  assert.ok(MIGRATION.includes("verticals         text[] not null default '{}'"));
});

test("le rollback retire la colonne ajoutée à `tenants`, jamais la table", () => {
  const rb = read("db/migrations/20260819_hermes_integrations_9_rollback.sql");
  assert.ok(rb.includes("alter table hermes_os.tenants drop column if exists vertical"));
  assert.ok(!rb.includes("drop table if exists hermes_os.tenants"));
  for (const fn of [
    "public.fail_integration_connection(text, text)",
    "hermes_os.tenant_allows_provider(text, text)",
  ]) {
    assert.ok(rb.includes(fn), `non annulé : ${fn}`);
  }
});

// ═══ LES ROUTES ══════════════════════════════════════════════════════════════

const START = read("app/api/integrations/[provider]/start/route.ts");
const CALLBACK = read("app/api/integrations/[provider]/callback/route.ts");
const DISCONNECT = read("app/api/integrations/[provider]/disconnect/route.ts");

test("les trois routes existent et gardent l'authentification en premier", () => {
  for (const [name, src] of [["start", START], ["callback", CALLBACK], ["disconnect", DISCONNECT]] as const) {
    assert.ok(src.includes("getAuthedUser()"), `${name} : garde absente`);
    const guard = src.indexOf("await getAuthedUser()");
    const rpc = src.indexOf(".rpc(");
    assert.ok(guard > 0 && (rpc === -1 || guard < rpc), `${name} : RPC avant la garde`);
  }
});

test("le callback boucle par la façade `authenticated`, jamais par service_role", () => {
  assert.ok(CALLBACK.includes("complete_integration_connection_self"));
  assert.ok(!CALLBACK.includes("complete_integration_connection\"")); // pas la variante service_role
  assert.ok(!stripComments(CALLBACK).toLowerCase().includes("service_role"));
});

test("le callback ne passe AUCUN tenant_id", () => {
  const call = CALLBACK.slice(CALLBACK.indexOf("complete_integration_connection_self"));
  assert.ok(!/p_tenant/i.test(call.slice(0, 600)));
});

test("la déconnexion est en POST — un GET serait déclenchable par une image", () => {
  assert.ok(DISCONNECT.includes("export async function POST("));
  assert.ok(!DISCONNECT.includes("export async function GET("));
});

test("aucune route ne renvoie de jeton au navigateur", () => {
  for (const [name, src] of [["start", START], ["callback", CALLBACK], ["disconnect", DISCONNECT]] as const) {
    const code = stripComments(src);
    assert.ok(!code.includes("NextResponse.json"), `${name} : réponse JSON (fuite possible)`);
    assert.ok(!/access_token[^:]/.test(code.replace(/exchanged\.accessToken/g, "")),
      `${name} : jeton manipulé hors échange`);
    assert.ok(!code.includes("vault_secret_id"), `${name} : pointeur Vault manipulé`);
  }
});

test("le démarrage demande un refresh_token, sinon la connexion mourrait", () => {
  assert.ok(START.includes('"access_type", "offline"'));
  assert.ok(START.includes('"prompt", "consent"'));
  assert.ok(START.includes('"state"'));
});

// ═══ HELPERS PURS ════════════════════════════════════════════════════════════

test("une redirection ouverte est impossible", () => {
  assert.equal(safeRedirectPath("/integrations"), "/integrations");
  assert.equal(safeRedirectPath("/seances"), "/seances");
  // `//evil.com` est une URL ABSOLUE pour un navigateur : c'est le piège.
  assert.equal(safeRedirectPath("//evil.com"), "/integrations");
  assert.equal(safeRedirectPath("https://evil.com"), "/integrations");
  assert.equal(safeRedirectPath(null), "/integrations");
  assert.equal(safeRedirectPath(42), "/integrations");
});

test("une expiration absente reste null — jamais inventée", () => {
  const r = parseTokenPayload({ access_token: "a", scope: "x y" });
  assert.ok(r.ok && r.expiresAt === null);
  assert.ok(r.ok && r.refreshToken === null);
  assert.deepEqual(r.ok ? r.scopes : null, ["x", "y"]);
});

test("une réponse sans access_token est un échec, pas une connexion vide", () => {
  assert.deepEqual(parseTokenPayload({}), { ok: false, code: "NO_ACCESS_TOKEN" });
  assert.deepEqual(parseTokenPayload({ access_token: "" }), { ok: false, code: "NO_ACCESS_TOKEN" });
  assert.deepEqual(parseTokenPayload(null), { ok: false, code: "NO_ACCESS_TOKEN" });
});

test("l'URI de retour est construite par UNE seule fonction (démarrage et retour)", () => {
  assert.equal(
    callbackUrl("https://hermes.example.com/", "google_calendar"),
    "https://hermes.example.com/api/integrations/google_calendar/callback",
  );
  assert.ok(START.includes("callbackUrl(request.nextUrl.origin, provider)"));
  assert.ok(CALLBACK.includes("callbackUrl(origin, provider)"));
});

test("déclaré n'est pas implémenté", () => {
  assert.deepEqual([...OAUTH_SERVER_PROVIDERS], ["google_calendar"]);
  assert.equal(isOAuthServerProvider("google_calendar"), true);
  assert.equal(isOAuthServerProvider("instagram"), false);
  assert.ok(START.includes("isOAuthServerProvider(provider)"));
});
