import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * SESSION-GUARD — Correctif de la rafale 42501/401.
 *
 * Cause démontrée (rapport de diagnostic) : chaque site d'appel construisait
 * son PROPRE client Supabase à partir des mêmes cookies entrants ; quand le
 * jeton d'accès était expiré, plusieurs clients tentaient en parallèle de
 * rafraîchir avec le MÊME refresh token à usage unique — le perdant recevait
 * `refresh_token_not_found`, retombait sur le rôle `anon`, et chaque RPC
 * protégée refusait à raison (42501 / HTTP 401).
 *
 * Ce dépôt n'a pas de harnais Next.js/Supabase en exécution réelle : comme
 * `tests/photo-dormancy.test.ts`, ces tests prouvent l'INVARIANT structurel
 * dans le code source réel plutôt que de simuler un serveur. Ce n'est pas
 * une preuve d'exécution bout-en-bout — c'est indiqué explicitement.
 */

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

// --- 1 & 6. UN SEUL client par requête : plus de course de rafraîchissement ---
test("un seul client Supabase par requête (cache()), aucune fuite de fabrique brute", () => {
  const server = read("../lib/supabase/server.ts");
  assert.ok(
    /export const createSupabaseServerClient = cache\(\s*async function/.test(server),
    "createSupabaseServerClient doit être mémoïsé par requête via cache()",
  );

  // Seuls les deux fichiers de fabrique légitimes touchent @supabase/ssr —
  // toute AUTRE construction directe réintroduirait la course.
  const filesImportingSsr = [
    "server.ts",
    "session.ts",
  ];
  for (const f of filesImportingSsr) {
    assert.ok(read(`../lib/supabase/${f}`).includes('from "@supabase/ssr"'));
  }
});

// --- 2 & 5. Non connecté / session invalide → redirect AVANT toute RPC métier ---
test("les 3 points d'entrée gardés redirigent vers /login avant tout Promise.all métier", () => {
  for (const page of [
    "../app/(dashboard)/layout.tsx",
    "../app/chantiers/carte/page.tsx",
    "../app/parametres/dashboard/page.tsx",
  ]) {
    const src = read(page);
    const guardIdx = src.indexOf('redirect("/login")');
    assert.notEqual(guardIdx, -1, `${page} : garde /login absente`);
    const fanOutIdx = src.indexOf("Promise.all(");
    if (fanOutIdx !== -1) {
      assert.ok(
        guardIdx < fanOutIdx,
        `${page} : le Promise.all métier doit être APRÈS la garde d'authentification`,
      );
    }
  }
});

// --- 3 & 4. getAuthedUser distingue explicitement l'échec de rafraîchissement ---
test("getAuthedUser journalise SESSION_EXPIRED_OR_INVALID sans jamais fabriquer un utilisateur", () => {
  const src = read("../lib/dashboard/requestScope.ts");
  assert.ok(src.includes('error.code === "refresh_token_not_found"'));
  assert.ok(src.includes("SESSION_EXPIRED_OR_INVALID"));
  // Le retour reste `user` (null en cas d'erreur) — jamais une valeur de repli.
  const fnIdx = src.indexOf("export const getAuthedUser = cache(");
  assert.notEqual(fnIdx, -1);
  const body = src.slice(fnIdx, src.indexOf("\n});", fnIdx));
  assert.ok(/return user;\s*$/.test(body.trim()));
});

test("le rafraîchissement au niveau proxy distingue aussi l'expiration attendue", () => {
  const src = read("../lib/supabase/session.ts");
  assert.ok(src.includes('error.code === "refresh_token_not_found"'));
  assert.ok(src.includes("SESSION_EXPIRED_OR_INVALID"));
});

// --- 7. Aucun droit anon ajouté ------------------------------------------------
test("ANON_GRANTS_ADDED=NO : aucun fichier de cette mission ne touche un GRANT SQL", () => {
  for (const file of [
    "../lib/supabase/server.ts",
    "../lib/supabase/session.ts",
    "../lib/dashboard/requestScope.ts",
    "../services/hermes/photo.ts",
  ]) {
    const src = read(file);
    assert.ok(!/\bgrant\b/i.test(src), `${file} : aucune instruction SQL n'a sa place ici`);
  }
});

// --- 8, 9, 10. PGRST202 : distinction propre, ciblée à l'exact --------------
test("photo.rpc_error : downgrade en warn UNIQUEMENT pour (get_photo_module_state, PGRST202)", () => {
  const src = read("../services/hermes/photo.ts");
  const fnIdx = src.indexOf("async function callRpc(");
  assert.notEqual(fnIdx, -1);
  const body = src.slice(fnIdx, src.indexOf("\n}", fnIdx));
  assert.ok(
    body.includes('fn === "get_photo_module_state" && error.code === "PGRST202"'),
    "la condition doit exiger LES DEUX critères, pas seulement le code",
  );
  assert.ok(body.includes('logEvent(dormant ? "warn" : "error"'));
});

test("toute autre erreur photo (autre code, ou autre RPC) reste au niveau error", () => {
  const src = read("../services/hermes/photo.ts");
  const fnIdx = src.indexOf("async function callRpc(");
  const body = src.slice(fnIdx, src.indexOf("\n}", fnIdx));
  // Le branch "else" du ternaire doit rester "error" — pas de downgrade global.
  assert.ok(/logEvent\(dormant \? "warn" : "error"/.test(body));
  // La seconde façade (get_photo_culling_review) ne passe pas par ce ternaire :
  // toute erreur dessus reste inconditionnellement "error".
  const cullingErrIdx = src.indexOf('logEvent("error", "photo.rpc_error", { fn: "get_photo_culling_review"');
  assert.notEqual(cullingErrIdx, -1, "get_photo_culling_review doit rester en error inconditionnel");
});
