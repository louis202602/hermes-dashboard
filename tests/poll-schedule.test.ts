import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  DEFAULT_POLL_SCHEDULE,
  POLL_BUDGET_MS,
  attemptsWithinBudget,
  elapsedMsAfter,
  pollDelayMs,
} from "../lib/dashboard/pollSchedule.ts";

/**
 * PHASE 2 — le sondage du gateway ne doit plus marteler la base quand la file
 * est froide (aucun consumer n8n actif), SANS raccourcir la fenêtre d'attente.
 */

// --- forme de la cadence -----------------------------------------------------
test("BACKOFF: la 1re tentative part vite, puis les délais croissent", () => {
  assert.equal(pollDelayMs(0), DEFAULT_POLL_SCHEDULE.baseMs);
  for (let i = 1; i < 12; i += 1) {
    assert.ok(
      pollDelayMs(i) >= pollDelayMs(i - 1),
      `le délai doit être monotone croissant (i=${i})`,
    );
  }
});

test("BACKOFF: le délai est borné par maxMs et jamais < baseMs", () => {
  for (let i = 0; i < 200; i += 1) {
    const d = pollDelayMs(i);
    assert.ok(d >= DEFAULT_POLL_SCHEDULE.baseMs, `délai ${d} < base`);
    assert.ok(d <= DEFAULT_POLL_SCHEDULE.maxMs, `délai ${d} > max`);
  }
  assert.equal(pollDelayMs(500), DEFAULT_POLL_SCHEDULE.maxMs);
});

test("ROBUSTESSE: aucune entrée ne peut produire 0, NaN ou un délai négatif", () => {
  for (const bad of [-1, -1000, Number.NaN, Number.POSITIVE_INFINITY, 0.4]) {
    const d = pollDelayMs(bad as number);
    assert.ok(Number.isFinite(d), `délai non fini pour ${String(bad)}`);
    assert.ok(d >= DEFAULT_POLL_SCHEDULE.baseMs, `délai ${d} trop court pour ${String(bad)}`);
  }
  // Un facteur dégénéré ne doit pas boucler ni annuler le recul.
  assert.ok(pollDelayMs(5, { factor: 0 }) >= DEFAULT_POLL_SCHEDULE.baseMs);
});

// --- la promesse chiffrée ----------------------------------------------------
test("COÛT: la fenêtre d'attente est CONSERVÉE, le nombre de requêtes s'effondre", () => {
  const action = attemptsWithinBudget(POLL_BUDGET_MS.action);
  const form = attemptsWithinBudget(POLL_BUDGET_MS.form);

  // Avant : intervalle fixe de 1,5 s => 200 et 40 tentatives.
  const before = { action: POLL_BUDGET_MS.action / 1500, form: POLL_BUDGET_MS.form / 1500 };
  assert.equal(before.action, 200);
  assert.equal(before.form, 40);

  assert.ok(action <= 25, `attendu <=25 tentatives sur 5 min, obtenu ${action}`);
  assert.ok(form <= 10, `attendu <=10 tentatives sur 60 s, obtenu ${form}`);
  // Réduction d'au moins 80 % dans les deux cas.
  assert.ok(action <= before.action * 0.2, `réduction insuffisante (${action}/200)`);
  assert.ok(form <= before.form * 0.2, `réduction insuffisante (${form}/40)`);
});

test("COÛT: le budget de temps n'est jamais dépassé", () => {
  for (const budget of [POLL_BUDGET_MS.action, POLL_BUDGET_MS.form, 1000, 5000, 45_000]) {
    const n = attemptsWithinBudget(budget);
    assert.ok(elapsedMsAfter(n) <= budget, `budget ${budget} dépassé après ${n} tentatives`);
  }
});

test("COÛT: la fenêtre reste assez longue pour couvrir une approbation humaine", () => {
  // Une action approuvée dans le panneau Approbations doit encore pouvoir
  // reprendre dans la conversation : au moins 4 minutes de couverture réelle.
  const n = attemptsWithinBudget(POLL_BUDGET_MS.action);
  assert.ok(elapsedMsAfter(n) >= 240_000, `couverture trop courte : ${elapsedMsAfter(n)} ms`);
});

test("BUDGET_NUL: aucun budget => aucune tentative (pas de boucle)", () => {
  for (const bad of [0, -1, Number.NaN]) {
    assert.equal(attemptsWithinBudget(bad as number), 0);
  }
});

// --- le correctif est réellement CÂBLÉ ---------------------------------------
const COMPONENTS = fileURLToPath(new URL("../components/dashboard/", import.meta.url));
const POLLING_FILES = ["HermesPanel.tsx", "AgentActionPanel.tsx", "ApprovalsPanel.tsx"];

test("CÂBLAGE: plus aucun setInterval de sondage du gateway", () => {
  for (const f of POLLING_FILES) {
    const src = readFileSync(`${COMPONENTS}${f}`, "utf8");
    assert.doesNotMatch(src, /setInterval/, `${f} utilise encore setInterval`);
  }
});

test("CÂBLAGE: chaque panneau qui sonde utilise la cadence partagée", () => {
  for (const f of POLLING_FILES) {
    const src = readFileSync(`${COMPONENTS}${f}`, "utf8");
    if (!src.includes("pollAgentActionResultAction")) continue;
    assert.match(src, /from "@\/lib\/dashboard\/pollSchedule"/, `${f} n'importe pas la cadence`);
    assert.match(src, /pollDelayMs\(/, `${f} n'applique pas le recul`);
    assert.match(src, /attemptsWithinBudget\(/, `${f} n'exprime pas sa limite en temps`);
  }
});

test("CÂBLAGE: aucune limite de sondage codée en dur ne subsiste", () => {
  for (const f of POLLING_FILES) {
    const src = readFileSync(`${COMPONENTS}${f}`, "utf8");
    const code = src
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    assert.doesNotMatch(code, /const\s+max(Attempts)?\s*=\s*\d+/, `${f} garde une limite en dur`);
    assert.doesNotMatch(code, /attempts\s*>=\s*\d+/, `${f} compare à une limite en dur`);
  }
});

test("PURETÉ: le module de cadence n'a ni I/O, ni DOM, ni horloge", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../lib/dashboard/pollSchedule.ts", import.meta.url)),
    "utf8",
  );
  // Les assertions portent sur le CODE, pas sur la prose qui explique l'usage.
  const code = src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
  for (const forbidden of [/fetch\(/, /window\./, /document\./, /Date\.now/, /setTimeout/]) {
    assert.doesNotMatch(code, forbidden, `impureté détectée: ${forbidden}`);
  }
});

test("RÉFÉRENCE: aucun autre module dashboard ne réintroduit un sondage fixe", () => {
  const offenders: string[] = [];
  for (const f of readdirSync(COMPONENTS)) {
    if (!f.endsWith(".tsx")) continue;
    const src = readFileSync(`${COMPONENTS}${f}`, "utf8");
    if (src.includes("pollAgentActionResultAction") && src.includes("setInterval")) {
      offenders.push(f);
    }
  }
  assert.deepEqual(offenders, [], `sondage à intervalle fixe réintroduit: ${offenders.join(", ")}`);
});
