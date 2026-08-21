import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  PHOTO_BLOCKED_LABEL,
  PHOTO_NEXT_ACTION_LABEL,
  PHOTO_STATUS_LABEL,
  PHOTO_STATUS_RANK,
  cullingSummary,
  isNextActionAvailable,
  nextActionHref,
  photoProgressPercent,
  photoStatusRank,
} from "../lib/photo/sessionState.ts";
import {
  PHOTO_NEXT_ACTIONS,
  PHOTO_SESSION_STATUSES,
  type PhotoSessionState,
} from "../types/photo.ts";

const MIGRATIONS = fileURLToPath(new URL("../db/migrations/", import.meta.url));

function state(partial: Partial<PhotoSessionState>): PhotoSessionState {
  return {
    ok: true,
    sessionId: "s1",
    status: "IMPORTED",
    statusRank: 5,
    nextAction: "REVIEW_CULLING",
    blockedBy: null,
    counters: {
      assets: 10,
      proxyReady: 10,
      proxyFailed: 0,
      signals: 10,
      verdicts: 10,
      undecided: 4,
      kept: 5,
      discarded: 1,
      protected: 2,
      bestOfSeries: 3,
      instructions: 1,
    },
    ...partial,
  };
}

// --- ANTI-DÉRIVE SQL ↔ TS ----------------------------------------------------
test("ANTI-DÉRIVE: la table des rangs TS reproduit exactement la fonction SQL", () => {
  const sql = readFileSync(`${MIGRATIONS}20260818_photo_studio_2_services.sql`, "utf8");
  const body = sql.slice(
    sql.indexOf("function hermes_os.photo_session_status_rank"),
    sql.indexOf("-- 2. STUDIO DIRECTOR"),
  );
  const fromSql: Record<string, number> = {};
  for (const match of body.matchAll(/when '([A-Z_]+)'\s+then\s+(-?\d+)/g)) {
    fromSql[match[1]] = Number(match[2]);
  }
  assert.ok(Object.keys(fromSql).length >= 15, "le SQL doit couvrir tous les statuts");
  assert.deepEqual(PHOTO_STATUS_RANK, fromSql);
});

test("ANTI-DÉRIVE: les statuts TS correspondent au CHECK de la migration de schéma", () => {
  const sql = readFileSync(`${MIGRATIONS}20260818_photo_studio_1_schema.sql`, "utf8");
  const block = sql.slice(sql.indexOf("status                  text not null default 'DRAFT'"));
  const declared = [...block.slice(0, 600).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  for (const status of PHOTO_SESSION_STATUSES) {
    assert.ok(declared.includes(status), `statut ${status} absent du CHECK SQL`);
  }
});

// --- COUVERTURE DES LIBELLÉS -------------------------------------------------
test("chaque statut et chaque action ont un libellé (aucun code brut affiché)", () => {
  for (const status of PHOTO_SESSION_STATUSES) {
    assert.ok(PHOTO_STATUS_LABEL[status]?.length > 0, `libellé manquant: ${status}`);
    assert.equal(typeof photoStatusRank(status), "number");
  }
  for (const action of PHOTO_NEXT_ACTIONS) {
    assert.ok(PHOTO_NEXT_ACTION_LABEL[action]?.length > 0, `libellé manquant: ${action}`);
  }
  assert.equal(photoStatusRank("PAS_UN_STATUT"), null);
});

// --- AVANCEMENT --------------------------------------------------------------
test("l'avancement va de 0 % à 100 % et une séance annulée reste à 0 %", () => {
  assert.equal(photoProgressPercent("DRAFT"), 0);
  assert.equal(photoProgressPercent("CLOSED"), 100);
  assert.equal(photoProgressPercent("CANCELLED"), 0);
  assert.equal(photoProgressPercent("INCONNU"), 0);
  assert.ok(photoProgressPercent("CULLED") > photoProgressPercent("SHOT"));
});

// --- HONNÊTETÉ DE L'ACTION SUIVANTE ------------------------------------------
test("HONNÊTETÉ: une étape bloquée par n8n n'est jamais proposée comme actionnable", () => {
  const blocked = state({ nextAction: "PREPARE_EDIT", blockedBy: "N8N_CONSUMER_REQUIRED" });
  assert.equal(isNextActionAvailable(blocked), false);
  assert.ok(PHOTO_BLOCKED_LABEL.N8N_CONSUMER_REQUIRED.length > 0, "le blocage doit être expliqué");
});

test("HONNÊTETÉ: 'NONE', état absent ou état en erreur ne sont jamais actionnables", () => {
  assert.equal(isNextActionAvailable(state({ nextAction: "NONE" })), false);
  assert.equal(isNextActionAvailable(state({ ok: false })), false);
  assert.equal(isNextActionAvailable(null), false);
});

test("les actions livrées en Phase 1 ont une destination, les autres non", () => {
  for (const action of ["IMPORT_ASSETS", "FINISH_IMPORT", "RUN_CULLING_PASS1", "REVIEW_CULLING", "APPROVE_SELECTION"] as const) {
    assert.equal(nextActionHref("abc", action), "/seances/abc/tri");
  }
  assert.equal(nextActionHref("abc", "MARK_SHOT"), "/seances/abc");
  // Étapes qui dépendent d'un runner n8n : aucune destination, donc aucun bouton.
  for (const action of ["PREPARE_EDIT", "APPROVE_EDIT", "EXPORT", "PREPARE_GALLERY", "PUBLISH_GALLERY", "NONE"] as const) {
    assert.equal(nextActionHref("abc", action), null);
  }
});

// --- RÉSUMÉ DU TRI -----------------------------------------------------------
test("le résumé du tri dérive des compteurs serveur, jamais des éléments affichés", () => {
  const summary = cullingSummary(state({}));
  assert.deepEqual(summary, {
    total: 10,
    decided: 6,
    undecided: 4,
    kept: 5,
    discarded: 1,
    protectedCount: 2,
  });
  assert.deepEqual(cullingSummary(null), {
    total: 0,
    decided: 0,
    undecided: 0,
    kept: 0,
    discarded: 0,
    protectedCount: 0,
  });
});

// --- PURETÉ ------------------------------------------------------------------
test("PURETÉ: le module de présentation ne fait ni I/O ni écriture", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../lib/photo/sessionState.ts", import.meta.url)),
    "utf8",
  );
  for (const forbidden of ["fetch(", "supabase", "document", "window", "delete "]) {
    assert.ok(!source.includes(forbidden), `sessionState ne doit pas contenir « ${forbidden} »`);
  }
});
