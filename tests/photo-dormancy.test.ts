import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { photoGateKeys } from "../lib/dashboard/photoAccess.ts";
import { availableProfiles, deriveCapabilityTokens } from "../lib/dashboard/profiles.ts";
import { availableWidgetIds } from "../lib/dashboard/widgets.ts";

/**
 * PHOTO-P0 — DORMANCE ABSOLUE.
 *
 * Ce fichier atteste, drapeau par drapeau, qu'après un merge du code SANS
 * migration ni activation, Hermès se comporte exactement comme avant. Les routes
 * existent dans le bundle Next.js — c'est inévitable — mais elles ne peuvent
 * retourner ni donnée, ni fonctionnalité.
 *
 *   PHOTO_VISIBLE_WITHOUT_MIGRATION  = NO
 *   PHOTO_ACTION_EXECUTABLE          = NO
 *   PHOTO_MENU_VISIBLE               = NO
 *   PHOTO_WIDGET_VISIBLE             = NO
 *   PHOTO_ROUTE_DATA_ACCESSIBLE      = NO
 *   EXISTING_TENANT_BEHAVIOR_CHANGED = NO
 */

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** Capacités d'un tenant BTP réel, telles que le catalogue les expose aujourd'hui. */
const TENANT_BTP = new Set([
  "btp.qualification.create",
  "btp.planning.phase.add",
  "btp.suivi.progress.report",
  "diag.echo",
]);

// --- PHOTO_VISIBLE_WITHOUT_MIGRATION = NO ------------------------------------
test("PHOTO_VISIBLE_WITHOUT_MIGRATION=NO : sans la RPC, le module est réputé désactivé", () => {
  const service = read("../services/hermes/photo.ts");
  // Sans migration, `get_photo_module_state` n'existe pas : la RPC échoue,
  // `callRpc` renvoie null, et le service DOIT retomber sur enabled:false.
  assert.ok(
    service.includes(
      'if (!payload) return { resolutionStatus: "UNAUTHENTICATED", tenantId: null, enabled: false };',
    ),
    "le repli d'erreur doit être fermé (enabled:false)",
  );
  // Aucune lecture photo ne suppose l'existence des tables : toutes passent par
  // `callRpc`, qui journalise et renvoie un résultat UNAVAILABLE.
  assert.ok(!service.includes("from hermes_os."), "aucun accès direct aux tables");
  assert.ok(!/\.from\(["'`]photo_/.test(service), "aucun accès PostgREST direct aux tables photo");
});

// --- PHOTO_ACTION_EXECUTABLE = NO --------------------------------------------
test("PHOTO_ACTION_EXECUTABLE=NO : aucune action photo n'est appelable", () => {
  // Côté applicatif : le code n'enfile JAMAIS une action photo.
  const files = [
    "../app/actions/photo.ts",
    "../services/hermes/photo.ts",
    "../components/dashboard/PhotoImportPanel.tsx",
    "../components/dashboard/PhotoCullingReview.tsx",
  ];
  for (const file of files) {
    const source = read(file);
    assert.ok(
      !source.includes("request_agent_action"),
      `${file} ne doit pas enfiler d'action de passerelle en Phase 1`,
    );
  }
  // Côté base : même après migration, les lignes sont `enabled=false`, et
  // `request_agent_action` filtre `enabled = true` (⇒ UNKNOWN_ACTION).
  const seeds = read("../db/migrations/20260818_photo_studio_5_dormant_registry.sql");
  assert.ok(seeds.includes("where action_key = … and enabled = true"), "invariant documenté");
});

// --- PHOTO_MENU_VISIBLE = NO --------------------------------------------------
test("PHOTO_MENU_VISIBLE=NO : les entrées de menu ne sont pas rendues par défaut", () => {
  const sidebar = read("../components/dashboard/Sidebar.tsx");
  assert.ok(sidebar.includes("showPhotoStudio = false"), "défaut non activé");
  assert.ok(sidebar.includes("!item.photoOnly || showPhotoStudio"), "filtre appliqué");
  const chrome = read("../components/dashboard/DashboardChrome.tsx");
  assert.ok(chrome.includes("showPhotoStudio = false"), "défaut non activé dans le chrome");
});

// --- PHOTO_WIDGET_VISIBLE = NO -------------------------------------------------
test("PHOTO_WIDGET_VISIBLE=NO : aucun widget photo pour un tenant non activé", () => {
  for (const keys of [TENANT_BTP, new Set<string>()]) {
    const available = availableWidgetIds(photoGateKeys(keys, false));
    for (const id of ["photo-today", "photo-sessions", "photo-culling-queue"]) {
      assert.equal(available.has(id), false, `${id} visible à tort`);
    }
  }
});

// --- PHOTO_ROUTE_DATA_ACCESSIBLE = NO ------------------------------------------
test("PHOTO_ROUTE_DATA_ACCESSIBLE=NO : double barrière page + façade", () => {
  // Barrière 1 — la page refuse.
  for (const page of [
    "../app/(dashboard)/seances/page.tsx",
    "../app/(dashboard)/seances/[id]/page.tsx",
    "../app/(dashboard)/seances/[id]/tri/page.tsx",
    "../app/(dashboard)/clients/page.tsx",
  ]) {
    assert.ok(read(page).includes("if (!ctx.photoEnabled) notFound();"), `${page} sans barrière`);
  }
  // Barrière 2 — chaque façade de données passe par la garde d'activation,
  // façades de STOCKAGE comprises (lot 4), pas seulement celles du lot 3.
  let checked = 0;
  for (const file of [
    "../db/migrations/20260818_photo_studio_3_facades.sql",
    "../db/migrations/20260818_photo_studio_4_storage_proxies.sql",
  ]) {
    const facades = read(file);
    const names = [...facades.matchAll(/create or replace function public\.(\w+)\(/g)].map(
      (m) => m[1],
    );
    for (const name of new Set(names)) {
      if (name === "get_photo_module_state") continue; // c'est elle qui RAPPORTE l'état
      const body = facades.slice(
        facades.indexOf(`create or replace function public.${name}(`),
        facades.indexOf(`revoke all on function public.${name}(`),
      );
      assert.ok(
        body.includes("hermes_os.photo_guard()"),
        `${name} n'applique pas la garde d'activation`,
      );
      checked += 1;
    }
  }
  assert.ok(checked >= 17, `attendu ≥17 façades gardées, vérifié ${checked}`);
  // Barrière 3 — les Server Actions n'ont aucun chemin qui contourne la façade.
  const actions = read("../app/actions/photo.ts");
  assert.ok(!actions.includes("createSupabaseServerClient"), "pas d'accès base direct");
});

// --- EXISTING_TENANT_BEHAVIOR_CHANGED = NO --------------------------------------
test("EXISTING_TENANT_BEHAVIOR_CHANGED=NO : un tenant BTP conserve tout", () => {
  const gate = photoGateKeys(TENANT_BTP, false);
  const available = availableWidgetIds(gate);
  for (const id of ["kpis", "projects", "agenda", "alerts", "cost", "approvals", "commercial"]) {
    assert.equal(available.has(id), true, `${id} perdu pour un tenant BTP`);
  }
  const tokens = deriveCapabilityTokens(gate);
  assert.equal(tokens.has("photo_studio"), false);
  const offered = availableProfiles(tokens, true);
  assert.equal(offered.includes("photographe"), false, "profil photo proposé à tort");
  for (const profile of ["direction", "chantier", "custom"]) {
    assert.ok(offered.includes(profile as never), `profil ${profile} perdu`);
  }
});

test("EXISTING_TENANT_BEHAVIOR_CHANGED=NO : les points d'extension sont optionnels", () => {
  // Un appelant existant qui ne passe pas le nouvel argument garde l'ancien
  // comportement à l'identique.
  assert.ok(read("../lib/dashboard/homeProfile.ts").includes("photoModuleEnabled = false"));
  const css = read("../app/globals.css");
  const block = css.slice(css.indexOf("PHOTO-P0 — Verticale Hermès Studio"));
  const selectors = [...block.matchAll(/^\.([a-z0-9-]+)/gm)].map((m) => m[1]);
  assert.ok(selectors.every((sel) => sel.startsWith("photo-")), "sélecteur non préfixé");
});

// --- RGPD : la chaîne complète, pas seulement les helpers ---------------------
test("RGPD: aucune biométrie ni reconnaissance faciale dans TOUTE la surface photo", () => {
  const roots = [
    { dir: "../lib/photo", files: readdirSync(fileURLToPath(new URL("../lib/photo", import.meta.url))) },
    { dir: "../db/migrations", files: readdirSync(fileURLToPath(new URL("../db/migrations", import.meta.url))).filter((f) => f.includes("photo_studio")) },
  ];
  const forbidden = [
    /face[_ ]?recognition/i,
    /facial[_ ]?recognition/i,
    /reconnaissance faciale(?!\s*(?:,|\.|\s+est|\s+n)|[^.]{0,80}(?:aucune|jamais|pas))/i,
    /face[_ ]?embedding/i,
    /biometric[_ ]?template/i,
    /\bgabarit\b(?![^.]{0,60}(?:aucun|jamais|pas))/i,
    /faceapi|insightface|mediapipe|tensorflow/i,
  ];
  for (const root of roots) {
    for (const file of root.files) {
      const source = read(`${root.dir}/${file}`);
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(source), `${file} : motif interdit ${pattern}`);
      }
    }
  }
  // Le GPS EXIF n'est pas lu (tag 0x8825 = GPSInfoIFDPointer).
  assert.ok(!read("../lib/photo/exif.ts").includes("0x8825"));
  // Aucune colonne de stockage biométrique.
  const schema = read("../db/migrations/20260818_photo_studio_1_schema.sql");
  for (const column of ["embedding", "descriptor", "face_id", "person_id", "latitude", "longitude"]) {
    assert.ok(!schema.includes(column), `colonne interdite : ${column}`);
  }
});
