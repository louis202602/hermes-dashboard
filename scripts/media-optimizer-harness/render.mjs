// Harnais de rendu du Media Optimizer — HORS route de production (aucune page Next ajoutée).
// Compile les composants avec l'API TypeScript, les rend côté serveur (react-dom/server) avec des
// FIXTURES DE TEST, injecte le vrai app/globals.css (compilé par Tailwind/PostCSS) et écrit des
// pages HTML statiques. Usage : node scripts/media-optimizer-harness/render.mjs <dossierSortie>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../..");
const OUT = path.resolve(process.argv[2] ?? "/home/claude/hermes-dashboard-shots");
const BUILD = path.join(OUT, ".build");
const require = createRequire(path.join(ROOT, "package.json"));
const ts = require("typescript");

fs.mkdirSync(BUILD, { recursive: true });
const link = path.join(BUILD, "node_modules");
if (!fs.existsSync(link)) fs.symlinkSync(path.join(ROOT, "node_modules"), link);

// 1. Transpilation (CommonJS) des seuls fichiers nécessaires.
function transpileDir(rel, pattern = /\.(ts|tsx)$/) {
  for (const f of fs.readdirSync(path.join(ROOT, rel))) {
    if (!pattern.test(f) || f.endsWith(".test.ts")) continue;
    const src = fs.readFileSync(path.join(ROOT, rel, f), "utf8");
    const js = ts.transpileModule(src, {
      fileName: f,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const dest = path.join(BUILD, rel, f.replace(/\.(ts|tsx)$/, ".js"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, js);
  }
}
transpileDir("components/media-optimizer");
transpileDir("lib/media-optimizer");
transpileDir("tests/fixtures");

// 2. Alias « @/ » → dossier compilé.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(BUILD, request.slice(2));
  return origResolve.call(this, request, ...rest);
};

// 3. Aperçus synthétiques (PIL).
const previewsJson = path.join(BUILD, "previews.json");
execFileSync("python3", ["-I", path.join(here, "make_previews.py"), previewsJson], { stdio: "inherit" });
const previews = JSON.parse(fs.readFileSync(previewsJson, "utf8"));

// 4. CSS réel de l'application.
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const cssSrc = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
const css = (await postcss([tailwind()]).process(cssSrc, { from: path.join(ROOT, "app/globals.css") })).css;

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { MediaOptimizerView } = require(path.join(BUILD, "components/media-optimizer/MediaOptimizerView.js"));
const { PreviewComparator } = require(path.join(BUILD, "components/media-optimizer/PreviewComparator.js"));
const { mapState, mapPreviews } = require(path.join(BUILD, "lib/media-optimizer/map.js"));
const fx = require(path.join(BUILD, "tests/fixtures/media-optimizer.fixtures.js"));

const noop = async () => {};
const actions = {
  requestOptimization: noop,
  setRights: noop,
  activateStop: noop,
  loadPreviews: async () => ({ ok: true, previews: [] }),
};

// Maquette minimale de la coque (barre latérale + en-tête) avec les VRAIES classes du tableau de bord.
function shell(title, body) {
  return `<!doctype html><html lang="fr" data-theme="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>${css}</style>
<style>.h-side{position:fixed;inset:0 auto 0 0;width:var(--sidebar-width);background:#0b1222;border-right:1px solid var(--border);padding:22px 17px;color:var(--text-muted);font-size:12px}
@media (max-width:820px){.h-side{display:none}}</style></head>
<body><div class="h-side">(barre latérale — maquette du harnais)</div>
<div class="dashboard-main"><header class="dashboard-header"><strong>Médiathèque</strong><span style="color:var(--text-muted);font-size:12px">(en-tête — maquette)</span></header>
<main class="dashboard-content">${body}</main></div></body></html>`;
}

const mk = (el) => renderToStaticMarkup(el);
const h = React.createElement;
const pages = {};

pages["liste-v3"] = mk(h(MediaOptimizerView, { state: mapState(fx.FIXTURE_STATE_V3), actions }));
pages["liste-v3-stop-desactive"] = mk(
  h(MediaOptimizerView, { state: { ...mapState(fx.FIXTURE_STATE_V3), publishStop: false }, actions }),
);
pages["migration-v3-absente"] = mk(h(MediaOptimizerView, { state: mapState(fx.FIXTURE_STATE_V2), actions }));
pages["module-non-active"] = mk(h(MediaOptimizerView, { state: null, actions }));

const all = mapPreviews(previews);
const card = (inner) => `<ul class="mo-grid"><li class="dashboard-card mo-card"><h3>FIXTURE DE TEST — comparateur</h3>${inner}</li></ul>`;
const cmp = (list) => mk(h(PreviewComparator, { jobId: "11111111-1111-4111-8111-111111111111", sizeBefore: 412000000, sizeAfter: 38400000, loadPreviews: actions.loadPreviews, initialPreviews: list }));
pages["comparateur"] =
  `<div class="page-stack mo-page">` +
  card(cmp(all)) + // toutes variantes : barre de choix + « Avant / après »
  card(cmp(all.filter((p) => p.kind === "orig_crop" || p.kind === "opt_crop"))) +
  card(cmp(all.filter((p) => p.kind === "pad916"))) +
  `</div>`;

for (const [name, body] of Object.entries(pages)) {
  fs.mkdirSync(path.join(OUT, "html"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "html", `${name}.html`), shell(`FIXTURE DE TEST — ${name}`, body));
}
console.log("pages :", Object.keys(pages).join(", "));
