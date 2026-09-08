import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { classifyAuthError } from "../lib/supabase/authError.ts";

/**
 * ANON-RPC-GUARD — « pas de session ⇒ /login ⇒ 0 RPC métier ».
 *
 * CAUSE RACINE (démontrée, pas supposée) : Next.js rend un layout et sa page
 * CONCURREMMENT. Le `redirect("/login")` du layout de groupe n'interrompt donc
 * PAS le rendu de la page en dessous : une page qui lance son propre fan-out
 * de lectures les émettait quand même pour un visiteur déconnecté — d'où la
 * rafale de 401/42501 observée en production pour une requête anonyme.
 * L'ancien commentaire de `app/(dashboard)/page.tsx` documentait d'ailleurs
 * explicitement ce comportement.
 *
 * LIMITE HONNÊTE : ce dépôt n'embarque aucun harnais Next.js/Supabase
 * exécutable (pas de serveur de test, pas de base éphémère), donc ces tests
 * — comme `photo-dormancy` et `session-guard` avant eux — prouvent
 * l'invariant STRUCTUREL sur le code source réel. Ils ne constituent pas une
 * preuve d'exécution bout-en-bout ; seule une requête anonyme réelle contre
 * un déploiement le serait.
 */

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel: string): string => readFileSync(here(rel), "utf8");

const GROUP = "../app/(dashboard)";

/** Toutes les pages du groupe (dashboard), récursivement. */
function groupPages(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(here(rel), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${rel}/${entry.name}`);
      else if (entry.name === "page.tsx") out.push(`${rel}/${entry.name}`);
    }
  };
  walk(GROUP);
  return out.sort();
}

/** Une page « lit des données » si elle importe un service Hermès ou le contexte de page. */
const fetchesData = (src: string): boolean =>
  /^import .*(services\/hermes|dashboard\/pageContext)/m.test(src);

/**
 * Index de la garde. Deux points d'entrée gardés sont acceptés :
 *   • `requireAuthedUser()` appelé directement par la page ;
 *   • `resolvePageContext()`, qui résout LUI-MÊME la garde avant son propre
 *     fan-out — prouvé par le test dédié ci-dessous.
 * Toute page lisant des données sans passer par l'un des deux échoue ici.
 */
function guardIndex(src: string): number {
  const body = src.slice(src.search(/^export default/m));
  const direct = body.indexOf("requireAuthedUser()");
  const viaContext = body.indexOf("resolvePageContext()");
  // `requireRoute` / `requireModule` appellent `resolvePageContext`, qui résout
  // `requireAuthedUser` AVANT tout fan-out : la garde d'authentification est
  // déléguée, pas perdue. Elle s'y ajoute un contrôle de module.
  const viaRoute = body.indexOf("requireRoute(");
  const viaModule = body.indexOf("requireModule(");
  const found = [direct, viaContext, viaRoute, viaModule].filter((i) => i !== -1);
  return found.length === 0 ? -1 : Math.min(...found);
}

/** Index de la première lecture métier qui n'est PAS un point d'entrée gardé. */
function firstReadIndex(src: string): number {
  const body = src.slice(src.search(/^export default/m));
  for (const m of body.matchAll(/await (Promise\.all|[a-z]\w*\()/g)) {
    const call = m[0];
    // Les points d'entrée GARDÉS ne sont pas des lectures métier : ils sont la
    // garde elle-même. `requireRoute`/`requireModule` en font partie — ils
    // résolvent `requireAuthedUser` avant tout fan-out.
    if (
      call.includes("requireAuthedUser(") ||
      call.includes("resolvePageContext(") ||
      call.includes("requireRoute(") ||
      call.includes("requireModule(")
    ) {
      continue;
    }
    return m.index;
  }
  return -1;
}

// --- 1 & 3. Visiteur sans cookie / session invalide → 0 RPC métier -------------
test("toute page du groupe qui lit des données résout la garde AVANT sa première lecture", () => {
  const pages = groupPages();
  assert.ok(pages.length >= 15, `attendu ≥15 pages, trouvé ${pages.length}`);

  let guarded = 0;
  for (const page of pages) {
    const src = read(page);
    if (!fetchesData(src)) continue; // aucune RPC ⇒ hors périmètre du défaut
    const g = guardIndex(src);
    const r = firstReadIndex(src);
    assert.notEqual(g, -1, `${page} : lit des données sans requireAuthedUser()`);
    if (r !== -1) {
      assert.ok(g < r, `${page} : la lecture précède la garde (fan-out anonyme possible)`);
    }
    guarded += 1;
  }
  assert.ok(guarded >= 12, `attendu ≥12 pages gardées, vérifié ${guarded}`);
});

test("resolvePageContext — le point de passage partagé — garde avant son propre Promise.all", () => {
  const src = read("../lib/dashboard/pageContext.ts");
  const g = src.indexOf("await requireAuthedUser()");
  const r = src.indexOf("await Promise.all(");
  assert.notEqual(g, -1, "pageContext doit résoudre la garde");
  assert.ok(g < r, "la garde doit précéder le fan-out de 4 RPC de pageContext");
});

// --- 2. Session absente → redirection /login ----------------------------------
test("requireAuthedUser redirige vers /login et ne renvoie jamais d'utilisateur fabriqué", () => {
  const src = read("../lib/dashboard/requestScope.ts");
  const fn = src.slice(src.indexOf("export async function requireAuthedUser"));
  assert.ok(fn.includes('if (!user) redirect("/login")'), "redirection fail-closed absente");
  assert.ok(/return user;/.test(fn), "doit renvoyer l'utilisateur réel, jamais un repli");
});

// --- 4. refresh_token_not_found → 0 RPC métier --------------------------------
test("refresh_token_not_found ⇒ user null ⇒ même garde ⇒ 0 RPC métier", () => {
  // getAuthedUser ne renvoie QUE `user` : toute erreur (dont refresh_token_not_found)
  // laisse `user` à null, et requireAuthedUser redirige donc avant toute lecture.
  const src = read("../lib/dashboard/requestScope.ts");
  const fn = src.slice(
    src.indexOf("export const getAuthedUser"),
    src.indexOf("export async function requireAuthedUser"),
  );
  assert.ok(!/return .*(\|\||\?\?)/.test(fn), "aucun repli ne doit masquer un user null");
  assert.equal(
    classifyAuthError({ name: "AuthApiError", code: "refresh_token_not_found", status: 400 })
      .reason,
    "SESSION_EXPIRED_OR_INVALID",
  );
});

// --- 5. Session valide → RPC métier autorisées --------------------------------
test("session valide : la garde laisse passer et le fan-out métier reste intact", () => {
  const home = read("../app/(dashboard)/page.tsx");
  // La garde n'est PAS conditionnelle : elle ne peut pas court-circuiter une session valide.
  assert.ok(home.includes("await requireAuthedUser();"), "garde absente du Home");
  // Le fan-out d'origine est conservé tel quel (aucune lecture supprimée).
  for (const call of [
    "getActiveTenantIdentity()",
    "getCostGovernanceSnapshot()",
    "getPlatformHealth()",
    "getCapabilitiesCached()",
    "getDashboardContextSettingsCached()",
    "getDashboardUserPreferences()",
    "getPhotoModuleStateCached()",
    "getPvOutreachSnapshot()",
    "resolvePageContext()",
  ]) {
    assert.ok(home.includes(call), `lecture ${call} perdue`);
  }
  // Coût inchangé : la garde réutilise le getAuthedUser mémoïsé (0 aller-retour ajouté).
  assert.ok(read("../lib/dashboard/requestScope.ts").includes("export const getAuthedUser = cache("));
});

// --- 6. Aucun droit anon ajouté -----------------------------------------------
test("ANON_GRANTS_ADDED=NO : aucun fichier touché ne contient de SQL de privilège", () => {
  for (const file of [
    "../lib/dashboard/requestScope.ts",
    "../lib/dashboard/pageContext.ts",
    "../lib/supabase/authError.ts",
    "../lib/supabase/session.ts",
    "../app/(dashboard)/layout.tsx",
    "../app/(dashboard)/page.tsx",
  ]) {
    assert.ok(!/\b(grant|revoke)\b/i.test(read(file)), `${file} : SQL de privilège interdit ici`);
  }
});

// --- 7. Une vraie erreur RPC authentifiée reste visible ------------------------
test("une anomalie technique d'auth reste error ; le cas anonyme normal ne l'est plus", () => {
  // Le visiteur anonyme : AuthSessionMissingError (status 400, code undefined) —
  // exactement la forme observée en production ({"code":null,"status":400}).
  const anon = classifyAuthError({ name: "AuthSessionMissingError", status: 400 });
  assert.equal(anon.reason, "NO_SESSION");
  assert.equal(anon.level, "info");

  // Une vraie panne reste bruyante.
  const broken = classifyAuthError({ name: "AuthRetryableFetchError", status: 503 });
  assert.equal(broken.reason, "AUTH_CHECK_ERROR");
  assert.equal(broken.level, "error");

  // Les erreurs RPC métier ne passent PAS par ce classifieur : elles restent error.
  const panels = read("../services/hermes/panels.ts");
  assert.ok(panels.includes('logEvent("error"'), "une erreur RPC authentifiée doit rester error");
});

// --- 8. La dormance Hermès Studio est inchangée -------------------------------
test("Studio reste dormant : garde photo intacte et PGRST202 toujours ciblé", () => {
  for (const page of [
    "../app/(dashboard)/seances/page.tsx",
    "../app/(dashboard)/seances/[id]/page.tsx",
    "../app/(dashboard)/seances/[id]/tri/page.tsx",
    "../app/(dashboard)/clients/page.tsx",
  ]) {
    // La garde ad hoc `!ctx.photoEnabled` est devenue la garde UNIFIÉE
    // `requireRoute`, qui interroge la même liste de modules que le menu.
    // L'invariant est inchangé : sans la verticale, la page n'existe pas.
    assert.ok(read(page).includes("requireRoute("), `${page} : garde perdue`);
  }
  const photo = read("../services/hermes/photo.ts");
  assert.ok(
    photo.includes('fn === "get_photo_module_state" && error.code === "PGRST202"'),
    "le downgrade PGRST202 doit rester ciblé sur la paire exacte",
  );
});
