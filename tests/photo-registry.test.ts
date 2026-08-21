import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { resolveTenantComposition } from "../lib/verticals/composition.ts";

import {
  PHOTO_CAPABILITY_PREFIX,
  PHOTO_STUDIO_CAPABILITY_KEY,
  hasPhotoStudio,
  photoGateKeys,
} from "../lib/dashboard/photoAccess.ts";
import {
  PROFILE_IDS,
  PROFILE_REGISTRY,
  availableProfiles,
  deriveCapabilityTokens,
  isProfileAvailable,
  presetLayoutFor,
} from "../lib/dashboard/profiles.ts";
import {
  WIDGET_REGISTRY,
  availableWidgetIds,
  registryIds,
  widgetById,
} from "../lib/dashboard/widgets.ts";
import { fr } from "../lib/i18n/locales/fr.ts";
import { en } from "../lib/i18n/locales/en.ts";
import { es } from "../lib/i18n/locales/es.ts";
import { de } from "../lib/i18n/locales/de.ts";
import { it } from "../lib/i18n/locales/it.ts";
import { pt } from "../lib/i18n/locales/pt.ts";

/**
 * PHOTO-P0 — portillon d'affichage de la verticale.
 *
 * L'invariant central de la Phase 1 : TANT QUE la verticale n'est pas activée
 * pour un tenant, elle n'existe pas pour lui — ni widget, ni profil, ni menu, ni
 * route. Ces tests le prouvent dans les deux sens.
 */

const PHOTO_WIDGETS = ["photo-today", "photo-sessions", "photo-culling-queue"];
const BTP_KEYS = new Set(["btp.qualification.create", "btp.suivi.progress.report"]);

// --- REGISTRE DES WIDGETS ----------------------------------------------------
test("les widgets photo sont enregistrés, uniques et tous gardés par le préfixe photo.", () => {
  for (const id of PHOTO_WIDGETS) {
    const def = widgetById(id);
    assert.ok(def, `widget ${id} absent du registre`);
    assert.equal(def.requiredCapabilityPrefix, PHOTO_CAPABILITY_PREFIX, `${id} non gardé`);
    assert.equal(def.category, "photo");
    assert.ok(def.label.length > 0);
  }
  const ids = registryIds();
  assert.equal(new Set(ids).size, ids.length, "les ids de widgets doivent rester uniques");
});

// --- L'INVARIANT : PAS D'ACTIVATION ⇒ RIEN ----------------------------------
test("INVARIANT: sans activation, AUCUN widget photo n'est disponible", () => {
  const gate = photoGateKeys(BTP_KEYS, false);
  const available = availableWidgetIds(gate);
  for (const id of PHOTO_WIDGETS) {
    assert.equal(available.has(id), false, `${id} ne doit pas être disponible`);
  }
  // Les widgets BTP existants, eux, ne sont pas affectés (non-régression).
  assert.equal(available.has("projects"), true);
  assert.equal(available.has("kpis"), true);
});

test("INVARIANT: sans activation, le profil photographe n'est pas proposé", () => {
  const tokens = deriveCapabilityTokens(photoGateKeys(BTP_KEYS, false));
  assert.equal(tokens.has("photo_studio"), false);
  assert.equal(availableProfiles(tokens, true).includes("photographe"), false);
});

test("INVARIANT: avec activation, widgets et profil photo apparaissent", () => {
  const gate = photoGateKeys(BTP_KEYS, true);
  const available = availableWidgetIds(gate);
  for (const id of PHOTO_WIDGETS) {
    assert.equal(available.has(id), true, `${id} devrait être disponible`);
  }
  const tokens = deriveCapabilityTokens(gate);
  assert.equal(tokens.has("photo_studio"), true);
  assert.equal(availableProfiles(tokens, true).includes("photographe"), true);
});

test("INVARIANT: un tenant SANS aucune capacité ne voit toujours rien de photo", () => {
  const available = availableWidgetIds(photoGateKeys(new Set<string>(), false));
  for (const id of PHOTO_WIDGETS) assert.equal(available.has(id), false);
});

// --- LA CLÉ SYNTHÉTIQUE N'EXÉCUTE RIEN ---------------------------------------
test("SÛRETÉ: la clé d'activation est un portillon d'AFFICHAGE, pas une action", () => {
  // Elle n'est pas une action du catalogue : elle ne porte pas de verbe métier.
  assert.equal(PHOTO_STUDIO_CAPABILITY_KEY, "photo.studio");
  const facades = readFileSync(
    fileURLToPath(new URL("../db/migrations/20260818_photo_studio_5_dormant_registry.sql", import.meta.url)),
    "utf8",
  );
  assert.ok(
    !facades.includes("'photo.studio'"),
    "photo.studio ne doit jamais être inséré dans agent_action_catalog",
  );
});

test("photoGateKeys ne mute jamais l'ensemble d'entrée", () => {
  const input = new Set(["btp.qualification.create"]);
  const gate = photoGateKeys(input, true);
  assert.equal(input.has(PHOTO_STUDIO_CAPABILITY_KEY), false, "l'entrée doit rester intacte");
  assert.equal(gate.has(PHOTO_STUDIO_CAPABILITY_KEY), true);
  assert.equal(gate.has("btp.qualification.create"), true);
});

test("hasPhotoStudio reconnaît aussi une vraie capacité photo (après go-live)", () => {
  assert.equal(hasPhotoStudio(new Set(["photo.culling.start"])), true);
  assert.equal(hasPhotoStudio(new Set(["btp.suivi.progress.report"])), false);
  assert.equal(hasPhotoStudio(new Set()), false);
});

// --- PROFIL ------------------------------------------------------------------
test("le profil photographe est bien enregistré et exige photo_studio", () => {
  assert.ok((PROFILE_IDS as readonly string[]).includes("photographe"));
  const def = PROFILE_REGISTRY.find((p) => p.id === "photographe");
  assert.ok(def, "profil absent du registre");
  assert.equal(def.availability, "capability");
  assert.deepEqual(def.requiredCapabilities, ["photo_studio"]);
  assert.equal(isProfileAvailable(def, new Set(["photo_studio"])), true);
  assert.equal(isProfileAvailable(def, new Set(["worksites"])), false);
});

test("le préréglage du profil photographe ne référence que des widgets existants", () => {
  const def = PROFILE_REGISTRY.find((p) => p.id === "photographe");
  assert.ok(def);
  const known = new Set(registryIds());
  for (const id of def.recommendedWidgets) {
    assert.ok(known.has(id), `widget recommandé inconnu: ${id}`);
  }
  const layout = presetLayoutFor("photographe");
  assert.ok(layout.order.length > 0);
  // Mode focus : tout ce qui n'est pas recommandé est masqué, rien n'est perdu.
  assert.equal(layout.order.length, registryIds().length);
});

// --- i18n ---------------------------------------------------------------------
test("les clés i18n de la verticale existent dans les 6 catalogues", () => {
  const catalogs: Record<string, Record<string, string>> = { fr, en, es, de, it, pt };
  const keys = ["profile.photographe", "profile.photographe.desc", "nav.photoSessions", "nav.photoClients"];
  for (const [lang, catalog] of Object.entries(catalogs)) {
    for (const key of keys) {
      assert.ok(catalog[key], `${lang}.${key} manquante`);
      assert.ok(catalog[key].length > 0, `${lang}.${key} vide`);
    }
  }
  // Les libellés ne sont pas de simples copies du français.
  assert.notEqual(en["nav.photoSessions"], fr["nav.photoSessions"]);
  assert.notEqual(de["profile.photographe"], fr["profile.photographe"]);
});

// --- NAVIGATION ---------------------------------------------------------------
test("les entrées de menu photo sont conditionnées, jamais rendues par défaut", () => {
  // Le conditionnement ne se lit plus dans la sidebar : il se PROUVE par le
  // calcul du menu. Sans la clé d'activation, aucune entrée photo n'existe.
  const withoutStudio = resolveTenantComposition({ capabilityKeys: [] }).navigation;
  const withStudio = resolveTenantComposition({
    capabilityKeys: ["photo.studio"],
  }).navigation;
  assert.ok(!withoutStudio.some((n) => n.moduleId === "photo.sessions"));
  assert.ok(withStudio.some((n) => n.moduleId === "photo.sessions"));
});

test("chaque page de la verticale refuse l'accès quand elle n'est pas activée", () => {
  const pages = [
    "../app/(dashboard)/seances/page.tsx",
    "../app/(dashboard)/seances/[id]/page.tsx",
    "../app/(dashboard)/seances/[id]/tri/page.tsx",
    "../app/(dashboard)/clients/page.tsx",
  ];
  for (const page of pages) {
    const source = readFileSync(fileURLToPath(new URL(page, import.meta.url)), "utf8");
    assert.ok(
      source.includes("requireRoute("),
      `${page} doit refuser l'accès sans activation`,
    );
  }
});

// --- CSS ----------------------------------------------------------------------
test("CSS: les classes de la verticale existent et n'écrasent aucune classe existante", () => {
  const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
  for (const cls of [
    ".photo-card",
    ".photo-grid",
    ".photo-cell",
    ".photo-decide",
    ".photo-session-list",
    ".photo-progress-track",
    ".photo-stat",
  ]) {
    assert.ok(css.includes(cls), `classe CSS manquante: ${cls}`);
  }
  // Toutes les nouvelles règles sont préfixées `photo-` : aucun sélecteur existant
  // n'est redéfini, donc aucune régression visuelle possible ailleurs.
  // La découpe s'arrête au bloc suivant (PV-2). Sans cette borne, le test
  // reprocherait au lot photovoltaïque de ne pas être préfixé `photo-` — ce qui
  // n'est pas ce qu'il vérifie : il garde LE BLOC PHOTO.
  const start = css.indexOf("PHOTO-P0 — Verticale Hermès Studio");
  const next = css.indexOf("PACK PHOTOVOLTAÏQUE — LOT PV-2.");
  const block = css.slice(start, next > start ? next : undefined);
  const selectors = [...block.matchAll(/^\.([a-z0-9-]+)/gm)].map((m) => m[1]);
  assert.ok(selectors.length > 5);
  for (const selector of selectors) {
    assert.ok(selector.startsWith("photo-"), `sélecteur non préfixé: .${selector}`);
  }
});

// --- COÛT ---------------------------------------------------------------------
test("COST-FIRST: les widgets photo lisent un instantané partagé, pas une lecture par widget", () => {
  for (const id of PHOTO_WIDGETS) {
    const def = widgetById(id);
    assert.ok(def);
    assert.deepEqual(def.snapshotKeys, ["photoToday"], `${id} doit partager le même instantané`);
  }
  // Le registre reste pur : aucun import de composant, aucune I/O.
  const source = readFileSync(
    fileURLToPath(new URL("../lib/dashboard/widgets.ts", import.meta.url)),
    "utf8",
  );
  assert.ok(!source.includes("fetch("));
  assert.ok(!source.includes("supabase"));
  assert.equal(WIDGET_REGISTRY.every((w) => Array.isArray(w.snapshotKeys)), true);
});
