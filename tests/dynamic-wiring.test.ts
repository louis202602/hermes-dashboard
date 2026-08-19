import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { resolveTenantComposition } from "../lib/verticals/composition.ts";
import { grantedModules } from "../lib/verticals/modules.ts";
import { isRouteAllowed } from "../lib/verticals/navigation.ts";
import {
  ACTIVE_TENANT_COOKIE,
  ACTIVE_TENANT_COOKIE_OPTIONS,
  canPersistSelection,
  isWellFormedTenantId,
  parseSelection,
  resolveSelection,
  selectableTenants,
} from "../lib/tenant/selection.ts";

/**
 * HERMÈS — câblage du moteur dynamique.
 *
 * Les tests de PR #60 prouvaient que le MOTEUR était correct. Ceux-ci prouvent
 * qu'il est BRANCHÉ : que la sidebar, les gardes de route et la page
 * d'intégrations lisent bien la même source, et qu'aucune vérité concurrente
 * n'a survécu.
 */

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/**
 * Code seul, commentaires retirés. Une phrase comme « cette application n'utilise
 * jamais la clé service-role » est une DOCUMENTATION, pas un usage : la chercher
 * dans le texte brut produirait un faux positif — et un test qui crie au loup
 * finit par être ignoré.
 */
const codeOnly = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .replace(/\/\/.*$/gm, "");

const PHOTO = ["photo.studio", "photo.culling.start"];
const SOLAR = ["btp.qualification.create", "btp.suivi.progress.report", "diag.echo"];
const IMMO = ["immo.lead.create", "immo.property.publish"];

// --- La divergence est-elle SUPPRIMÉE, pas seulement corrigée ? ---------------

test("la sidebar ne contient plus AUCUNE liste de navigation écrite à la main", () => {
  const src = read("components/dashboard/Sidebar.tsx");
  assert.ok(!/const NAV\b/.test(src), "un tableau NAV subsiste dans la sidebar");
  assert.ok(!src.includes("photoOnly"), "le booléen photoOnly subsiste");
  assert.ok(!src.includes("showPhotoStudio"), "la prop showPhotoStudio subsiste");
  // Elle rend ce que le serveur lui donne.
  assert.ok(src.includes("navigation: NavEntry[]"));
  assert.ok(src.includes("navigation.filter"));
});

test("le layout compose le menu, il ne le déclare pas", () => {
  const src = read("app/(dashboard)/layout.tsx");
  assert.ok(src.includes("resolveTenantComposition"));
  assert.ok(src.includes("navigation={composition.navigation}"));
});

test("le contexte de page porte la composition — une seule source pour tous", () => {
  const src = read("lib/dashboard/pageContext.ts");
  assert.ok(src.includes("resolveTenantComposition"));
  assert.ok(src.includes("composition: TenantComposition"));
});

// --- /chantiers/carte : LE défaut, fermé --------------------------------------

test("/chantiers/carte est gardée côté SERVEUR, plus seulement cachée du menu", () => {
  const src = read("app/chantiers/carte/page.tsx");
  assert.ok(src.includes('requireRoute("/chantiers/carte")'), "garde absente");
  // L'ancienne garde « authentifié = suffisant » ne doit plus exister.
  assert.ok(!src.includes("auth.getUser()"), "l'ancienne garde auth-seule subsiste");
});

test("tenant photo → /chantiers/carte REFUSÉ", () => {
  assert.equal(isRouteAllowed("/chantiers/carte", grantedModules(["photo_studio"])), false);
});

test("tenant immobilier → /chantiers/carte REFUSÉ", () => {
  const immo = resolveTenantComposition({ capabilityKeys: IMMO });
  assert.equal(isRouteAllowed("/chantiers/carte", immo.modules), false);
});

test("tenant solaire/BTP autorisé → /chantiers/carte ACCESSIBLE", () => {
  const solar = resolveTenantComposition({ capabilityKeys: SOLAR });
  assert.equal(isRouteAllowed("/chantiers/carte", solar.modules), true);
});

test("les pages photo lisent la MÊME garde que /chantiers/carte", () => {
  for (const p of [
    "app/(dashboard)/clients/page.tsx",
    "app/(dashboard)/seances/page.tsx",
    "app/(dashboard)/seances/[id]/page.tsx",
    "app/(dashboard)/seances/[id]/tri/page.tsx",
  ]) {
    const src = read(p);
    assert.ok(src.includes("requireRoute("), `${p} : garde unifiée absente`);
    assert.ok(!src.includes("ctx.photoEnabled"), `${p} : garde ad hoc subsistante`);
  }
});

test("un tenant solaire ne peut pas atteindre /seances par URL directe", () => {
  const solar = resolveTenantComposition({ capabilityKeys: SOLAR });
  assert.equal(isRouteAllowed("/seances", solar.modules), false);
  assert.equal(isRouteAllowed("/seances/abc/tri", solar.modules), false);
  assert.equal(isRouteAllowed("/clients", solar.modules), true); // il a `sales`
});

// --- Intégrations : filtrées par verticale dans l'interface -------------------

test("la page d'intégrations filtre par verticale et le dit honnêtement", () => {
  const src = read("app/(dashboard)/integrations/page.tsx");
  assert.ok(src.includes("composition.integrationProviders"));
  assert.ok(src.includes("requireRoute("));
  // L'honnêteté compte autant que le filtre : ce n'est PAS la barrière.
  assert.ok(
    src.includes("COMMODITÉ D'AFFICHAGE") || src.includes("commodité d'affichage"),
    "le filtre d'interface doit être documenté comme non-barrière",
  );
});

test("un tenant solaire ne se voit pas proposer Instagram", () => {
  const solar = resolveTenantComposition({
    capabilityKeys: SOLAR,
    enabledIntegrationProviders: ["google_calendar", "gmail", "meta", "instagram"],
  });
  assert.ok(!solar.integrationProviders.includes("instagram"));
  assert.ok(solar.integrationProviders.includes("google_calendar"));
});

test("un studio photo se voit proposer Instagram", () => {
  const photo = resolveTenantComposition({
    capabilityKeys: PHOTO,
    enabledIntegrationProviders: ["google_calendar", "gmail", "meta", "instagram"],
  });
  assert.ok(photo.integrationProviders.includes("instagram"));
});

// --- Aperçu déterministe du dashboard Vanessa ---------------------------------

test("le menu Vanessa vient des MODULES accordés, jamais d'une liste écrite", () => {
  const vanessa = resolveTenantComposition({
    capabilityKeys: [
      "photo.studio",
      "photo.culling.start",
      "photo.gallery.publish",
      "photo.marketing.publish",
      "photo.lead.create",
      "photo.client.message.send",
    ],
    permissions: ["tenant.member"],
    enabledIntegrationProviders: ["google_calendar", "gmail", "meta", "instagram"],
  });

  assert.equal(vanessa.vertical, "photography");
  assert.equal(vanessa.suggestedProfile, "photographe");

  const ids = vanessa.navigation.map((n) => n.moduleId);
  // Les entrées du brief Studio présentes à ce niveau de la pile. Les 5 modules
  // de commerce (devis, paiements, portail, upsell, fidélisation) arrivent avec
  // les briques Studio, empilées au-dessus : le menu complet y est vérifié.
  for (const expected of [
    "core.home", "crm.prospects", "crm.clients", "photo.sessions", "agenda",
    "phone", "campaigns", "photo.gallery", "core.integrations", "core.settings",
  ]) {
    assert.ok(ids.includes(expected), `entrée manquante au menu Vanessa : ${expected}`);
  }
  // L'ORDRE vient de la verticale, pas du registre.
  assert.equal(ids[0], "core.home");
  assert.ok(ids.indexOf("photo.sessions") < ids.indexOf("phone"));
  // Et rien d'une autre verticale.
  for (const forbidden of ["worksites", "solar.studies", "immo.properties"]) {
    assert.ok(!ids.includes(forbidden), `entrée étrangère au menu Vanessa : ${forbidden}`);
  }
});

test("les pages non construites sont COMING_SOON, jamais des liens morts", () => {
  const vanessa = resolveTenantComposition({ capabilityKeys: PHOTO });
  for (const entry of vanessa.navigation) {
    if (entry.comingSoon) {
      assert.equal(entry.href, null, `${entry.moduleId} : « bientôt » avec un href`);
    } else {
      assert.ok(entry.href, `${entry.moduleId} : construit mais sans href`);
    }
  }
});

// --- Sélection du tenant ------------------------------------------------------

test("un utilisateur mono-tenant ne voit RIEN changer", () => {
  const r = resolveSelection([{ tenantId: "studio-vanessa", label: "Studio" }], null);
  assert.equal(r.outcome, "SINGLE_TENANT");
  assert.equal(r.requestedTenantId, null); // ⇒ resolve_active_tenant(null), comme aujourd'hui
  assert.equal(r.mustChoose, false);
});

test("multi-tenant sans sélection ⇒ on demande, on ne devine pas", () => {
  const r = resolveSelection(
    [{ tenantId: "a", label: "A" }, { tenantId: "b", label: "B" }],
    null,
  );
  assert.equal(r.outcome, "SELECTION_REQUIRED");
  assert.equal(r.requestedTenantId, null);
  assert.equal(r.mustChoose, true);
});

test("une sélection valide est appliquée", () => {
  const r = resolveSelection(
    [{ tenantId: "a", label: "A" }, { tenantId: "b", label: "B" }],
    "b",
  );
  assert.equal(r.outcome, "SELECTION_APPLIED");
  assert.equal(r.requestedTenantId, "b");
});

test("un tenant FORGÉ n'est jamais honoré", () => {
  const memberships = [{ tenantId: "a", label: "A" }, { tenantId: "b", label: "B" }];
  for (const forged of ["heliosolar", "../admin", "'; drop table--", "A", ""]) {
    const r = resolveSelection(memberships, forged);
    assert.notEqual(r.outcome, "SELECTION_APPLIED", `tenant forgé honoré : ${forged}`);
    assert.equal(r.requestedTenantId, null);
  }
});

test("une sélection ne peut être persistée que pour un tenant dont on est membre", () => {
  const memberships = [{ tenantId: "a", label: "A" }];
  assert.equal(canPersistSelection(memberships, "a"), true);
  assert.equal(canPersistSelection(memberships, "b"), false);
  assert.equal(canPersistSelection(memberships, "../a"), false);
});

test("la forme d'un tenant_id est contrôlée avant même d'atteindre la base", () => {
  assert.equal(isWellFormedTenantId("studio-vanessa"), true);
  assert.equal(isWellFormedTenantId("Studio"), false);
  assert.equal(isWellFormedTenantId("-a"), false);
  assert.equal(isWellFormedTenantId("a".repeat(64)), false);
  assert.equal(parseSelection("  studio-vanessa  "), "studio-vanessa");
  assert.equal(parseSelection(null), null);
});

test("le cookie de sélection est verrouillé (préfixe __Host-, httpOnly, sameSite)", () => {
  assert.ok(ACTIVE_TENANT_COOKIE.startsWith("__Host-"));
  assert.equal(ACTIVE_TENANT_COOKIE_OPTIONS.httpOnly, true);
  assert.equal(ACTIVE_TENANT_COOKIE_OPTIONS.secure, true);
  assert.equal(ACTIVE_TENANT_COOKIE_OPTIONS.sameSite, "lax");
  assert.equal(ACTIVE_TENANT_COOKIE_OPTIONS.path, "/");
});

// --- Founder : aucun cross-tenant implicite -----------------------------------

test("FOUNDER n'ajoute AUCUN tenant à la liste sélectionnable", () => {
  const memberships = [{ tenantId: "heliosolar", label: "HelioSolar" }];
  assert.deepEqual(selectableTenants(memberships), memberships);
  // Et la liste vient d'une lecture `tenant.member` : la façade SQL le dit.
  const sql = codeOnly("db/migrations/20260820_hermes_tenant_selection_1.sql");
  assert.ok(sql.includes("p.permission = 'tenant.member'"));
  assert.ok(!sql.includes("hermes.founder"), "un privilège founder est câblé dans la façade");
  assert.ok(!sql.includes("hermes.operator"), "un privilège operator est câblé dans la façade");
});

test("la migration de sélection ne touche PAS resolve_active_tenant", () => {
  const sql = read("db/migrations/20260820_hermes_tenant_selection_1.sql");
  assert.ok(!/create or replace function .*resolve_active_tenant/i.test(sql));
  assert.ok(sql.includes("⚠️ NON APPLIQUÉE"));
  assert.ok(sql.includes("begin;"));
  assert.ok(sql.trimEnd().endsWith("commit;"));
});

test("set_active_tenant vérifie l'appartenance AVANT d'écrire", () => {
  const sql = read("db/migrations/20260820_hermes_tenant_selection_1.sql");
  const fn = sql.slice(sql.indexOf("function public.set_active_tenant"));
  const memberCheck = fn.indexOf("permission = 'tenant.member'");
  const insert = fn.indexOf("insert into hermes_os.user_active_tenant");
  assert.ok(memberCheck > 0 && insert > 0 && memberCheck < insert,
    "l'écriture précède la vérification d'appartenance");
  assert.ok(fn.includes("NOT_A_MEMBER"));
});

test("le rollback annule tout ce que la migration crée", () => {
  const rb = read("db/migrations/20260820_hermes_tenant_selection_9_rollback.sql");
  for (const o of ["public.clear_active_tenant()", "public.set_active_tenant(text)",
                   "public.get_my_tenants()", "hermes_os.user_active_tenant"]) {
    assert.ok(rb.includes(o), `non annulé : ${o}`);
  }
});

// --- Aucun secret côté application --------------------------------------------

test("aucune clé service_role nulle part dans l'application", () => {
  for (const p of [
    "lib/supabase/server.ts",
    "app/(dashboard)/layout.tsx",
    "lib/dashboard/routeGuard.ts",
    "lib/tenant/selection.ts",
  ]) {
    const src = codeOnly(p).toLowerCase();
    assert.ok(!src.includes("service_role"), `${p} : usage de service_role dans le code`);
    assert.ok(!src.includes("service-role"), `${p} : usage de service-role dans le code`);
    assert.ok(!src.includes("supabase_service"), `${p} : clé de service référencée`);
  }
});
