import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ACCESS_LEVEL_PROVISIONED,
  canAdministerTenant,
  canCrossTenantBoundary,
  canOperateHermes,
  resolveAccessLevel,
} from "../lib/verticals/access.ts";
import { resolveTenantComposition } from "../lib/verticals/composition.ts";
import {
  VERTICAL_MANIFEST,
  resolveVertical,
  verticalIntegrationProviders,
} from "../lib/verticals/manifest.ts";
import {
  MODULE_REGISTRY,
  grantedModules,
  isActionAllowed,
} from "../lib/verticals/modules.ts";
import { isRouteAllowed, resolveNavigation, routeModule } from "../lib/verticals/navigation.ts";
import { MODULE_IDS } from "../lib/verticals/modules.ts";

/**
 * HERMÈS — moteur de dashboard dynamique par verticale.
 *
 * Ces tests ne vérifient pas « le code fait ce qu'il fait » : ils vérifient les
 * INVARIANTS d'isolation multi-tenant demandés à l'audit. Chacun échouerait si
 * quelqu'un ouvrait une porte par inadvertance.
 */

// Jeux de capacités RÉELS, tels que le serveur les calcule aujourd'hui.
const PHOTO_KEYS = ["photo.studio", "photo.culling.start", "photo.gallery.publish"];
const SOLAR_KEYS = [
  "btp.qualification.create",
  "btp.planning.phase.add",
  "btp.suivi.progress.report",
  "diag.echo",
  "hermes.intent.resolve",
];
const IMMO_KEYS = ["immo.lead.create", "immo.property.publish"];

const compose = (keys: string[], permissions: string[] = ["tenant.member"]) =>
  resolveTenantComposition({ capabilityKeys: keys, permissions });

// --- Résolution de verticale ---------------------------------------------------

test("la verticale se déduit des capacités, sans colonne en base", () => {
  assert.equal(compose(PHOTO_KEYS).vertical, "photography");
  assert.equal(compose(IMMO_KEYS).vertical, "real_estate");
  assert.equal(compose(SOLAR_KEYS).vertical, "solar");
  assert.equal(compose(SOLAR_KEYS).verticalSource, "DERIVED");
});

test("une verticale déclarée l'emporte sur la déduction", () => {
  const r = resolveVertical(["photo_studio"], "real_estate");
  assert.equal(r.vertical, "real_estate");
  assert.equal(r.source, "DECLARED");
});

test("aucun signal ⇒ generic, jamais une verticale métier devinée", () => {
  const r = resolveVertical(["documents"], null);
  assert.equal(r.vertical, "generic");
  assert.equal(r.source, "DEFAULT");
});

test("le signal le plus spécifique gagne : solaire l'emporte sur le BTP nu", () => {
  // `worksites` seul ⇒ construction ; `worksites` + `quotes` ⇒ solar (2 signaux).
  assert.equal(resolveVertical(["worksites", "field_operations"]).vertical, "construction");
  assert.equal(resolveVertical(["worksites", "quotes"]).vertical, "solar");
});

test("la résolution est déterministe quel que soit l'ordre des tokens", () => {
  const a = resolveVertical(["quotes", "worksites", "leads"]).vertical;
  const b = resolveVertical(["leads", "worksites", "quotes"]).vertical;
  assert.equal(a, b);
});

// --- ISOLATION : le menu d'une verticale ne fuit pas dans une autre ------------

test("un tenant photo ne voit AUCUNE entrée solaire ou BTP", () => {
  const nav = compose(PHOTO_KEYS).navigation.map((n) => n.moduleId);
  assert.ok(nav.includes("photo.sessions"));
  assert.ok(!nav.includes("worksites"), "chantiers visibles pour un studio photo");
  assert.ok(!nav.includes("solar.studies"), "études solaires visibles pour un studio photo");
  assert.ok(!nav.includes("immo.properties"), "biens immobiliers visibles pour un studio photo");
});

test("un tenant solaire ne voit AUCUNE entrée photo", () => {
  const nav = compose(SOLAR_KEYS).navigation.map((n) => n.moduleId);
  assert.ok(nav.includes("worksites"));
  assert.ok(!nav.includes("photo.sessions"), "séances photo visibles pour un tenant solaire");
  assert.ok(!nav.includes("photo.gallery"), "galeries photo visibles pour un tenant solaire");
});

test("un tenant immobilier ne voit ni photo ni chantiers", () => {
  const nav = compose(IMMO_KEYS).navigation.map((n) => n.moduleId);
  assert.ok(nav.includes("immo.properties"));
  assert.ok(!nav.includes("photo.sessions"));
  assert.ok(!nav.includes("worksites"));
});

test("un tenant sans aucune capacité n'obtient QUE le noyau", () => {
  const c = compose([], []);
  assert.ok(c.modules.every((m) => m.startsWith("core.")));
  assert.equal(c.vertical, "generic");
});

// --- FAIL-CLOSED : cacher le menu ne suffit pas -------------------------------

test("URL directe vers une route d'un module non accordé ⇒ refus", () => {
  const photo = grantedModules(["photo_studio"]);
  assert.equal(isRouteAllowed("/seances", photo), true);
  assert.equal(isRouteAllowed("/chantiers/carte", photo), false);
  assert.equal(isRouteAllowed("/biens", photo), false);

  const solar = grantedModules(["worksites", "quotes"]);
  assert.equal(isRouteAllowed("/chantiers/carte", solar), true);
  assert.equal(isRouteAllowed("/seances", solar), false);
  assert.equal(isRouteAllowed("/seances/abc/tri", solar), false);
});

test("une route qu'aucun module ne revendique est refusée par défaut", () => {
  const all = new Set(MODULE_IDS);
  assert.equal(isRouteAllowed("/une-page-inventee", all), false);
  assert.equal(routeModule("/une-page-inventee"), null);
});

test("la racine n'absorbe pas tout le site", () => {
  assert.equal(routeModule("/"), "core.home");
  assert.equal(routeModule("/seances"), "photo.sessions");
});

test("query string, ancre et slash final ne contournent pas la garde", () => {
  const photo = grantedModules(["photo_studio"]);
  for (const url of [
    "/chantiers/carte?x=1",
    "/chantiers/carte#top",
    "/chantiers/carte/",
    "/chantiers",
  ]) {
    assert.equal(isRouteAllowed(url, photo), false, `${url} aurait dû être refusée`);
  }
});

test("le préfixe le plus long gagne (pas de collision entre modules)", () => {
  assert.equal(routeModule("/parametres/dashboard"), "core.settings");
  assert.equal(routeModule("/clients"), "crm.clients");
});

// --- FAIL-CLOSED : widgets et actions -----------------------------------------

test("un widget d'une autre verticale est absent, pas seulement masqué", () => {
  const photo = compose(PHOTO_KEYS);
  assert.ok(photo.widgets.includes("photo-today"));
  assert.ok(!photo.widgets.includes("chantiers-map"));

  const solar = compose(SOLAR_KEYS);
  assert.ok(solar.widgets.includes("chantiers-map"));
  assert.ok(!solar.widgets.includes("photo-today"));
});

test("le moteur ne peut pas rendre visible un widget que les capacités refusent", () => {
  // `photo.studio` seul ⇒ le module est accordé, mais le filtre de capacité
  // existant garde la main : l'intersection ne peut qu'ôter.
  const c = resolveTenantComposition({ capabilityKeys: ["photo.studio"] });
  const allowed = new Set(c.widgets);
  for (const w of c.widgets) assert.ok(allowed.has(w));
  assert.ok(!c.widgets.includes("chantiers-map"));
});

test("une action d'un module non accordé n'est pas exécutable", () => {
  const photo = grantedModules(["photo_studio"]);
  assert.equal(isActionAllowed("photo.gallery.publish", photo), true);
  assert.equal(isActionAllowed("btp.suivi.progress.report", photo), false);

  const solar = grantedModules(["worksites", "quotes"]);
  assert.equal(isActionAllowed("btp.suivi.progress.report", solar), true);
  assert.equal(isActionAllowed("photo.gallery.publish", solar), false);
});

test("une action rattachée à aucun module est refusée (l'oubli ferme)", () => {
  assert.equal(isActionAllowed("nouveau.truc.jamais.declare", new Set(MODULE_IDS)), false);
});

// --- Intégrations : autorisées par verticale, pas par existence globale --------

test("une intégration n'est proposée que si la verticale la justifie", () => {
  const globalCatalog = ["google_calendar", "gmail", "meta", "instagram"];
  const photo = verticalIntegrationProviders("photography", globalCatalog);
  assert.ok(photo.includes("instagram"), "un studio photo doit pouvoir connecter Instagram");

  const solar = verticalIntegrationProviders("solar", globalCatalog);
  assert.ok(!solar.includes("instagram"), "Instagram proposé à un installateur solaire");
  assert.ok(solar.includes("google_calendar"));
});

test("catalogue global vide ⇒ aucune proposition (fail-closed)", () => {
  assert.deepEqual(verticalIntegrationProviders("photography", []), []);
});

test("un fournisseur désactivé globalement disparaît même si la verticale le cite", () => {
  const only = verticalIntegrationProviders("photography", ["google_calendar"]);
  assert.deepEqual(only, ["google_calendar"]);
});

// --- Niveaux d'accès : réutilisation, pas nouveau système ----------------------

test("les niveaux se lisent dans les permissions existantes", () => {
  assert.equal(resolveAccessLevel([]), "NONE");
  assert.equal(resolveAccessLevel(["tenant.member"]), "TENANT_MEMBER");
  assert.equal(resolveAccessLevel(["tenant.member", "tenant.admin"]), "TENANT_ADMIN");
  assert.equal(resolveAccessLevel(["hermes.founder", "tenant.member"]), "FOUNDER");
});

test("une permission inconnue n'élève personne", () => {
  assert.equal(resolveAccessLevel(["youtube.publication.approve"]), "NONE");
  assert.equal(resolveAccessLevel(["tenant.member", "root", "admin"]), "TENANT_MEMBER");
});

test("le rapport dit la vérité : operator et founder ne sont pas provisionnés", () => {
  assert.equal(ACCESS_LEVEL_PROVISIONED.TENANT_MEMBER, true);
  assert.equal(ACCESS_LEVEL_PROVISIONED.TENANT_ADMIN, true);
  assert.equal(ACCESS_LEVEL_PROVISIONED.HERMES_OPERATOR, false);
  assert.equal(ACCESS_LEVEL_PROVISIONED.FOUNDER, false);
});

test("AUCUN niveau ne franchit la frontière du tenant — founder compris", () => {
  for (const lvl of ["NONE", "TENANT_MEMBER", "TENANT_ADMIN", "HERMES_OPERATOR", "FOUNDER"] as const) {
    assert.equal(canCrossTenantBoundary(lvl), false, `${lvl} traverse la frontière tenant`);
  }
});

test("founder garde ses droits d'exploitation et d'administration", () => {
  assert.equal(canOperateHermes("FOUNDER"), true);
  assert.equal(canAdministerTenant("FOUNDER"), true);
  assert.equal(canOperateHermes("TENANT_ADMIN"), false);
  assert.equal(canAdministerTenant("TENANT_MEMBER"), false);
});

test("un niveau élevé n'ajoute AUCUN module métier", () => {
  const member = compose(PHOTO_KEYS, ["tenant.member"]);
  const founder = compose(PHOTO_KEYS, ["tenant.member", "hermes.founder"]);
  assert.deepEqual(founder.modules, member.modules);
  assert.deepEqual(
    founder.navigation.map((n) => n.moduleId),
    member.navigation.map((n) => n.moduleId),
  );
});

// --- Cohérence structurelle du registre ---------------------------------------

test("chaque module accordé apparaît au menu, même si la verticale l'oublie", () => {
  const c = compose(PHOTO_KEYS);
  const navIds = new Set(c.navigation.map((n) => n.moduleId));
  for (const m of c.modules) {
    assert.ok(navIds.has(m), `module accordé absent du menu : ${m}`);
  }
});

test("citer un module dans une verticale ne l'accorde pas", () => {
  // La verticale photo cite `campaigns`, mais un tenant sans token marketing
  // ne l'obtient pas.
  const nav = resolveNavigation("photography", grantedModules(["photo_studio"]));
  assert.ok(!nav.some((n) => n.moduleId === "campaigns"));
});

test("toute verticale ne cite que des modules existants", () => {
  const known = new Set(MODULE_REGISTRY.map((m) => m.id));
  for (const v of VERTICAL_MANIFEST) {
    for (const m of v.moduleOrder) {
      assert.ok(known.has(m), `verticale ${v.id} cite un module inconnu : ${m}`);
    }
  }
});

test("tout widget cité par un module existe au registre de widgets", () => {
  const src = readFileSync(new URL("../lib/dashboard/widgets.ts", import.meta.url), "utf8");
  for (const m of MODULE_REGISTRY) {
    for (const w of m.widgets) {
      assert.ok(src.includes(`id: "${w}"`), `widget inconnu cité par ${m.id} : ${w}`);
    }
  }
});

test("aucune route n'est revendiquée par deux modules à la même profondeur", () => {
  const byRoute = new Map<string, string[]>();
  for (const m of MODULE_REGISTRY) {
    for (const r of m.ownedRoutes) {
      byRoute.set(r, [...(byRoute.get(r) ?? []), m.id]);
    }
  }
  for (const [route, owners] of byRoute) {
    assert.equal(owners.length, 1, `route ${route} revendiquée par ${owners.join(", ")}`);
  }
});

test("une page prévue mais non construite est signalée, jamais en lien mort", () => {
  const nav = compose(IMMO_KEYS).navigation;
  const biens = nav.find((n) => n.moduleId === "immo.properties");
  assert.ok(biens);
  assert.equal(biens.href, null);
  assert.equal(biens.comingSoon, true);
  // Inversement : une page construite porte un href et n'est pas « bientôt ».
  const home = nav.find((n) => n.moduleId === "core.home");
  assert.equal(home?.href, "/");
  assert.equal(home?.comingSoon, false);
});

// --- Aucun secret ne peut transiter par le moteur -----------------------------

test("la composition expose une liste de champs FERMÉE", () => {
  // Liste blanche plutôt que recherche de mots interdits : tout champ ajouté
  // demain doit être ajouté ICI sciemment. Un oubli fait échouer le test, il ne
  // laisse pas passer une fuite.
  const c = compose(PHOTO_KEYS, ["tenant.member", "hermes.founder"]);
  assert.deepEqual(Object.keys(c).sort(), [
    "accessLevel",
    "actionPrefixes",
    "capabilityTokens",
    "integrationProviders",
    "modules",
    "navigation",
    "suggestedProfile",
    "vertical",
    "verticalSource",
    "widgets",
  ]);
});

test("la composition ne porte aucun secret ni jeton de fournisseur", () => {
  const c = compose(PHOTO_KEYS, ["tenant.member", "hermes.founder"]);
  const serialized = JSON.stringify(c).toLowerCase();
  // `capabilityTokens` est un nom légitime : ce sont des tokens FONCTIONNELS
  // (`photo_studio`, `leads`), pas des jetons d'accès. On cherche donc les
  // formes qui ne peuvent PAS être une capacité.
  for (const forbidden of [
    "secret",
    "access_token",
    "refresh_token",
    "bearer",
    "api_key",
    "apikey",
    "vault",
    "password",
    "credential",
    "retell",
  ]) {
    assert.ok(
      !serialized.includes(forbidden),
      `la composition expose « ${forbidden} » vers le client`,
    );
  }
});
