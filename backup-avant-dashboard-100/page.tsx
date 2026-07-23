"use client";

import { useState } from "react";

/* ============================================================
   ICÔNES — SVG minimalistes inline (aucune dépendance externe)
   ============================================================ */

type IconProps = { className?: string };

function makeIcon(path: string) {
  return function IconCmp({ className = "h-5 w-5" }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
      >
        <path d={path} />
      </svg>
    );
  };
}

const IconHome = makeIcon("M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9");
const IconFolder = makeIcon("M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z");
const IconWorkflow = makeIcon("M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z");
const IconDocument = makeIcon("M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM14 3v5h5");
const IconIntelligence = makeIcon(
  "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"
);
const IconAgents = makeIcon(
  "M8 8h8v6a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2ZM12 8V5M9 5h6M9.5 12.5h.01M14.5 12.5h.01"
);
const IconSettings = makeIcon(
  "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14 3h-4l-.6 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2L10 21h4l.6-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z"
);
const IconSearch = makeIcon("M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3");
const IconBell = makeIcon("M6 8a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 12 6 8ZM9.5 17a2.5 2.5 0 0 0 5 0");
const IconSun = makeIcon(
  "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"
);
const IconMoon = makeIcon("M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z");
const IconChevronRight = makeIcon("m9 6 6 6-6 6");
const IconChevronDown = makeIcon("m6 9 6 6 6-6");
const IconSend = makeIcon("M6 18 18 6M9 6h9v9");
const IconCheckCircle = makeIcon("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8 12l2.5 2.5L16 9");
const IconLogout = makeIcon("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9");
const IconUsers = makeIcon(
  "M8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM17 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM2 20c0-3 3-5 6-5s6 2 6 5M15 20c0-2 1.5-4 4-4.5"
);
const IconOptimize = makeIcon("M4 6h10M4 12h16M4 18h7M14 4v4M20 10v4M11 16v4");
const IconBolt = makeIcon("M13 2 3 14h7l-1 8 10-12h-7Z");
const IconFolderPlus = makeIcon(
  "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM12 11v4M10 13h4"
);
const IconChartBar = makeIcon("M4 20V10M10 20V4M16 20v-7M4 20h16");
const IconMenu = makeIcon("M4 7h16M4 12h16M4 17h16");
const IconClose = makeIcon("M6 6l12 12M18 6 6 18");

/* ============================================================
   DONNÉES STATIQUES
   ============================================================ */

const navigation = [
  { label: "Accueil", Icon: IconHome },
  { label: "Projets", Icon: IconFolder },
  { label: "Workflows", Icon: IconWorkflow },
  { label: "Documents", Icon: IconDocument },
  { label: "Intelligence", Icon: IconIntelligence },
  { label: "Agents", Icon: IconAgents },
  { label: "Paramètres", Icon: IconSettings },
];

const heroStats = [
  { value: "58", label: "Directeurs IA" },
  { value: "11", label: "Workflows actifs" },
  { value: "3", label: "Actions en attente" },
  { value: "2", label: "Agents en cours" },
];

const quickActions = [
  { label: "Créer un projet", Icon: IconFolderPlus, tint: "bg-violet-500/15 text-violet-300" },
  { label: "Analyser des données", Icon: IconChartBar, tint: "bg-pink-500/15 text-pink-300" },
  { label: "Générer un devis", Icon: IconDocument, tint: "bg-sky-500/15 text-sky-300" },
  { label: "Optimiser un workflow", Icon: IconBolt, tint: "bg-amber-500/15 text-amber-300" },
];

const kpis = [
  { label: "Projets en cours", value: "12", delta: "+2 ce mois-ci", color: "text-sky-400", stroke: "#38bdf8" },
  { label: "Devis générés", value: "28", delta: "+15 %", color: "text-violet-400", stroke: "#a78bfa" },
  { label: "Taux de conversion", value: "68 %", delta: "+8 %", color: "text-emerald-400", stroke: "#34d399" },
  { label: "Économies réalisées", value: "34 200 €", delta: "+12 %", color: "text-amber-400", stroke: "#fbbf24" },
];

const sparkPaths = [
  "M1 20 8 16 15 18 22 10 29 12 36 6 43 8",
  "M1 18 8 14 15 16 22 9 29 11 36 5 43 3",
  "M1 16 8 17 15 12 22 13 29 8 36 9 43 4",
  "M1 19 8 15 15 17 22 11 29 13 36 7 43 5",
];

const tasks = [
  { status: "info", title: "Valider le devis Fermelec", time: "Aujourd'hui" },
  { status: "warning", title: "Analyser toiture 13010", time: "Aujourd'hui" },
  { status: "success", title: "Rendez-vous client", time: "Demain · 10:00" },
  { status: "success", title: "Optimisation workflow Relances", time: "Demain" },
];

const taskDot: Record<string, string> = {
  info: "bg-sky-400",
  warning: "bg-amber-400",
  success: "bg-emerald-400",
};

const projects = [
  { name: "Fermelec Marseille", detail: "9 kWc", percent: 75 },
  { name: "SOCOMAC Ytrac", detail: "151,6 kWc", percent: 60 },
  { name: "Jean Dépôt", detail: "67 kWc", percent: 30 },
];

const suggestions = [
  { Icon: IconUsers, tint: "bg-violet-500/15 text-violet-300", title: "Relancer 8 prospects", subtitle: "Taux de réponse élevé" },
  { Icon: IconOptimize, tint: "bg-teal-500/15 text-teal-300", title: "Optimiser vos campagnes", subtitle: "Budget sous-utilisé" },
  { Icon: IconBolt, tint: "bg-amber-500/15 text-amber-300", title: "Nouveau potentiel détecté", subtitle: "23 toitures disponibles" },
];

/* ------------------------------------------------------------
   Champ d'étoiles déterministe (fond spatial de la carte Hermès)
   Générateur pseudo-aléatoire à graine fixe : rendu identique
   côté serveur et client (aucun risque d'hydratation React).
   ------------------------------------------------------------ */

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const starRandom = mulberry32(1337);

const stars = Array.from({ length: 110 }, (_, i) => {
  const sizeRoll = starRandom();
  const twinkle = i % 12 === 0;
  const tint = i % 17 === 3 ? "warm" : i % 23 === 5 ? "cool" : "white";
  return {
    id: i,
    x: +(starRandom() * 100).toFixed(2),
    y: +(starRandom() * 100).toFixed(2),
    size: sizeRoll < 0.68 ? 1 : sizeRoll < 0.9 ? 1.5 : sizeRoll < 0.98 ? 2 : 2.5,
    opacity: +(0.12 + starRandom() * 0.58).toFixed(2),
    twinkle,
    tint,
    delay: +(starRandom() * 6).toFixed(2),
  };
});

const starColor: Record<string, string> = {
  white: "255,255,255",
  warm: "255,214,170",
  cool: "180,210,255",
};

/* ============================================================
   PETITS COMPOSANTS
   ============================================================ */

function Sparkline({ path, stroke }: { path: string; stroke: string }) {
  return (
    <svg viewBox="0 0 44 24" className="h-10 w-full">
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ============================================================
   PAGE
   ============================================================ */

export default function Home() {
  const [isDark, setIsDark] = useState(true);
  const [activePage, setActivePage] = useState("Accueil");
  const [command, setCommand] = useState("");
  const [navOpen, setNavOpen] = useState(false);

  const dark = isDark;

  const pageBg = dark
    ? "bg-[#060c18] text-slate-100"
    : "bg-[radial-gradient(circle_at_20%_-10%,rgba(158,201,255,0.3),transparent_50%),radial-gradient(circle_at_100%_0%,rgba(200,220,255,0.22),transparent_45%),radial-gradient(circle_at_50%_105%,rgba(180,205,240,0.16),transparent_55%),linear-gradient(180deg,#eef3fa_0%,#e1e8f4_45%,#d3ddec_100%)] text-[#16253b]";

  const panel = dark
    ? "border-white/[0.08] bg-white/[0.03]"
    : "border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_20px_-10px_rgba(15,23,42,0.1),0_32px_56px_-24px_rgba(15,23,42,0.18)]";

  const muted = dark ? "text-slate-400" : "text-slate-500";
  const subtle = dark ? "text-slate-500" : "text-slate-400";

  return (
    <main className={`min-h-screen overflow-x-hidden ${pageBg}`}>
      {/* Barre mobile compacte (< md) */}
      <div
        className={`flex items-center justify-between border-b px-4 py-3 md:hidden ${
          dark ? "border-white/10 bg-[#0a1220]/90" : "border-slate-200 bg-white/90"
        }`}
      >
        <button
          aria-label="Ouvrir la navigation"
          onClick={() => setNavOpen(true)}
          className={`flex h-9 w-9 items-center justify-center rounded-xl border ${panel}`}
        >
          <IconMenu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <IconSun className="h-4 w-4 text-amber-400" />
          <div className="text-center leading-tight">
            <p className="text-[11px] font-bold tracking-[0.2em]">HELIOSOLAR</p>
            <p className="text-[10px] font-semibold text-sky-400">OS</p>
          </div>
        </div>
        <button
          aria-label={dark ? "Activer le mode clair" : "Activer le mode sombre"}
          onClick={() => setIsDark(!dark)}
          className={`flex h-9 w-9 items-center justify-center rounded-xl border ${panel} ${
            dark ? "text-amber-300" : "text-slate-500"
          }`}
        >
          {dark ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
        </button>
      </div>

      {/* Panneau latéral coulissant (mobile) */}
      {navOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setNavOpen(false)} />
          <div
            className={`absolute left-0 top-0 flex h-full w-72 max-w-[82%] flex-col overflow-y-auto p-5 ${
              dark ? "bg-[#0a1220] text-slate-100" : "bg-white text-[#16253b]"
            }`}
          >
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <IconSun className="h-5 w-5 text-amber-400" />
                <div className="leading-tight">
                  <p className="text-xs font-bold tracking-[0.2em]">HELIOSOLAR</p>
                  <p className="text-[11px] font-semibold text-sky-400">OS</p>
                </div>
              </div>
              <button
                aria-label="Fermer la navigation"
                onClick={() => setNavOpen(false)}
                className={`flex h-8 w-8 items-center justify-center rounded-xl border ${panel}`}
              >
                <IconClose className="h-4 w-4" />
              </button>
            </div>

            <nav className="space-y-1">
              {navigation.map(({ label, Icon }) => (
                <button
                  key={label}
                  onClick={() => {
                    setActivePage(label);
                    setNavOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm transition-colors ${
                    activePage === label
                      ? "bg-sky-400/10 font-medium text-sky-400"
                      : `${muted} hover:bg-white/5 hover:text-sky-300`
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </button>
              ))}
            </nav>

            <div className="mt-6 space-y-3">
              <div className={`rounded-xl border p-3 ${panel}`}>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-400/10 text-sky-400">
                    Σ
                  </span>
                  Hermès
                </div>
                <p className={`mt-0.5 text-xs ${subtle}`}>Directeur IA</p>
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  En ligne
                </div>
              </div>

              <div className={`flex items-center gap-3 rounded-xl border p-3 ${panel}`}>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-400 text-sm font-semibold text-[#06111f]">
                  LP
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">Louis Preira</p>
                  <p className={`text-xs ${subtle}`}>Directeur</p>
                </div>
                <IconChevronRight className={`h-4 w-4 ${subtle}`} />
              </div>

              <button
                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-2.5 text-sm ${panel} ${muted}`}
              >
                <IconLogout className="h-4 w-4" />
                Déconnexion
              </button>
            </div>

            <p className={`mt-auto pt-6 text-center text-[10px] ${subtle}`}>
              v1.0.0 · © HelioSolar OS 2026
            </p>
          </div>
        </div>
      )}

      <div className="mx-auto flex min-h-screen max-w-[1680px] flex-col md:flex-row">
        {/* ============ SIDEBAR DESKTOP ============ */}
        <aside
          className={`hidden w-full shrink-0 flex-col border-b p-5 md:flex md:sticky md:top-0 md:h-screen md:w-64 md:border-b-0 md:border-r lg:w-72 ${
            dark ? "border-white/10 bg-[#0a1220]" : "border-slate-200 bg-white"
          }`}
        >
          <div className="mb-8 flex items-center gap-2.5 px-1">
            <IconSun className="h-6 w-6 text-amber-400" />
            <div className="leading-tight">
              <p className="text-sm font-bold tracking-[0.18em]">HELIOSOLAR</p>
              <p className="text-xs font-semibold text-sky-400">OS</p>
            </div>
          </div>

          <nav className="space-y-1">
            {navigation.map(({ label, Icon }) => (
              <button
                key={label}
                onClick={() => setActivePage(label)}
                className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm transition-colors ${
                  activePage === label
                    ? "bg-sky-400/10 font-medium text-sky-400"
                    : `${muted} hover:bg-white/[0.04] hover:text-sky-300`
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            ))}
          </nav>

          <div className="mt-6 space-y-3">
            <div className={`rounded-xl border p-3 ${panel}`}>
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-400/10 text-sky-400">
                  Σ
                </span>
                Hermès
              </div>
              <p className={`mt-0.5 text-xs ${subtle}`}>Directeur IA</p>
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                En ligne
              </div>
            </div>
          </div>

          <div className="mt-auto space-y-3 pt-5">
            <button className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${panel}`}>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-400 text-sm font-semibold text-[#06111f]">
                LP
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">Louis Preira</p>
                <p className={`text-xs ${subtle}`}>Directeur</p>
              </div>
              <IconChevronRight className={`h-4 w-4 ${subtle}`} />
            </button>

            <button
              className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm ${panel} ${muted}`}
            >
              <IconLogout className="h-4 w-4" />
              Déconnexion
            </button>

            <p className={`px-1 text-[10px] ${subtle}`}>v1.0.0 · © HelioSolar OS 2026</p>
          </div>
        </aside>

        {/* ============ CONTENU PRINCIPAL ============ */}
        <section className="min-w-0 flex-1 px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
          {/* Header : recherche + notifications + thème + profil */}
          <div className="mb-6 flex items-center justify-between gap-4">
            <label
              className={`flex h-11 w-full max-w-sm items-center gap-2.5 rounded-xl border px-4 text-sm transition-shadow focus-within:ring-1 focus-within:ring-sky-400/40 ${panel} ${muted}`}
            >
              <IconSearch className="h-4 w-4 shrink-0" />
              <input
                aria-label="Rechercher"
                type="search"
                placeholder="Rechercher..."
                className="w-full bg-transparent outline-none placeholder:text-inherit"
              />
              <span className="hidden shrink-0 rounded border border-current/20 px-1.5 py-0.5 text-[10px] sm:block">
                ⌘ K
              </span>
            </label>

            <div className="flex items-center gap-2">
              <button
                aria-label="Afficher les notifications"
                className={`relative flex h-10 w-10 items-center justify-center rounded-full border ${panel} ${muted}`}
              >
                <IconBell className="h-[18px] w-[18px]" />
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 text-[10px] font-semibold text-white">
                  2
                </span>
              </button>
              <button
                aria-label={dark ? "Activer le mode clair" : "Activer le mode sombre"}
                onClick={() => setIsDark(!dark)}
                className={`flex h-10 w-10 items-center justify-center rounded-full border ${panel} ${
                  dark ? "text-amber-300" : "text-slate-500"
                }`}
              >
                {dark ? <IconSun className="h-[18px] w-[18px]" /> : <IconMoon className="h-[18px] w-[18px]" />}
              </button>
              <button className="hidden items-center gap-1.5 sm:flex">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-sky-300 to-sky-500 text-sm font-semibold text-[#06111f]">
                  LP
                </span>
                <IconChevronDown className={`h-4 w-4 ${subtle}`} />
              </button>
            </div>
          </div>

          {/* Salutation + météo */}
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                Bonjour <span className="text-sky-400">Louis</span>
              </h1>
              <p className={`mt-2 text-sm ${muted}`}>Hermès est prêt à vous assister.</p>
              <p className={`text-sm ${muted}`}>Que souhaitez-vous accomplir aujourd'hui ?</p>
            </div>

            <div className={`flex items-center gap-4 rounded-2xl border px-5 py-3 ${panel}`}>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-400/15">
                <IconSun className="h-5 w-5 text-amber-400" />
              </span>
              <div>
                <p className="text-lg font-semibold">16°C</p>
                <p className={`text-xs ${subtle}`}>Marseille, France</p>
              </div>
              <div className={`border-l pl-4 text-xs ${dark ? "border-white/10" : "border-slate-200"} ${subtle}`}>
                <p>Mercredi 22 juillet 2026</p>
                <p className="mt-0.5 font-medium">09:42</p>
              </div>
            </div>
          </div>

          {/* ============ CARTE HERMÈS (fixe, toujours sombre) ============ */}
          <section className="relative mb-5 overflow-hidden rounded-[28px] border border-white/10 bg-[#050b16] p-6 sm:p-8 lg:p-10">
            {/* Animations dédiées à cette carte (aucune dépendance externe) */}
            <style>{`
              @keyframes hos-twinkle { 0%, 100% { opacity: .12; } 50% { opacity: .85; } }
              @keyframes hos-ring-a { from { transform: rotate(-10deg); } to { transform: rotate(350deg); } }
              @keyframes hos-ring-b { from { transform: rotate(14deg); } to { transform: rotate(-346deg); } }
              @keyframes hos-core-pulse { 0%, 100% { transform: scale(1); filter: brightness(1); } 50% { transform: scale(1.035); filter: brightness(1.12); } }
              @keyframes hos-drift { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(2px, -3px); } }
              @keyframes hos-flow { to { stroke-dashoffset: -120; } }
            `}</style>

            {/* Nébuleuse diffuse + halos lointains + poussière cosmique (profondeur) */}
            <div className="pointer-events-none absolute inset-0 bg-sky-500/[0.025]" style={{ filter: "blur(40px)" }} />
            <div className="pointer-events-none absolute -left-20 top-6 h-[380px] w-[380px] rounded-full bg-sky-500/[0.08]" style={{ filter: "blur(90px)" }} />
            <div className="pointer-events-none absolute right-1/3 -bottom-24 h-[300px] w-[300px] rounded-full bg-indigo-500/[0.07]" style={{ filter: "blur(80px)" }} />
            <div className="pointer-events-none absolute left-1/2 top-1/3 h-[260px] w-[260px] -translate-x-1/2 rounded-full bg-fuchsia-500/[0.035]" style={{ filter: "blur(85px)" }} />
            <div className="pointer-events-none absolute left-[18%] top-[22%] h-16 w-16 rounded-full bg-sky-200/10 blur-2xl" />
            <div className="pointer-events-none absolute left-[68%] top-[65%] h-20 w-20 rounded-full bg-white/[0.06] blur-2xl" />

            {/* Champ d'étoiles irrégulier, teintes variées */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              {stars.map((star) => (
                <span
                  key={star.id}
                  className="absolute rounded-full"
                  style={{
                    left: `${star.x}%`,
                    top: `${star.y}%`,
                    width: star.size,
                    height: star.size,
                    backgroundColor: `rgba(${starColor[star.tint]},1)`,
                    opacity: star.opacity,
                    animation: star.twinkle ? "hos-twinkle 5.5s ease-in-out infinite" : undefined,
                    animationDelay: star.twinkle ? `${star.delay}s` : undefined,
                  }}
                />
              ))}
            </div>

            {/* Planète (visibilité réduite ~30% en mode clair) */}
            <div
              className={`absolute -right-28 -top-14 h-[440px] w-[440px] rounded-full transition-opacity duration-300 ${
                dark ? "opacity-100" : "opacity-70"
              }`}
            >
              {/* Halo atmosphérique externe */}
              <div className="absolute -inset-8 -z-10 rounded-full bg-sky-500/15" style={{ filter: "blur(60px)" }} />

              {/* Fond de secours si la texture n'est pas encore présente */}
              <div className="absolute inset-0 rounded-full bg-[#152c46]" />

              {/* Base photographique réelle (NASA Blue Marble, domaine public) */}
              <div
                className="absolute inset-0 rounded-full bg-cover bg-center"
                style={{ backgroundImage: "url(/textures/earth.jpg)", backgroundPosition: "38% 42%" }}
              />

              {/* Rehaussement subtil des reliefs/nuages (au-dessus de la photo) */}
              <div
                className="absolute inset-0 rounded-full opacity-40 mix-blend-overlay"
                style={{
                  background:
                    "radial-gradient(circle at 32% 28%, rgba(255,255,255,0.25), transparent 30%), radial-gradient(circle at 60% 60%, rgba(0,10,20,0.25), transparent 45%)",
                }}
              />

              {/* Terminateur jour/nuit */}
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background:
                    "linear-gradient(112deg, transparent 32%, rgba(2,6,12,0.55) 52%, rgba(1,3,8,0.94) 74%)",
                }}
              />

              {/* Lumières urbaines nocturnes, discrètes */}
              <div
                className="absolute inset-0 rounded-full opacity-80"
                style={{
                  backgroundImage:
                    "radial-gradient(1px 1px at 66% 52%, rgba(255,214,140,0.85), transparent), radial-gradient(1px 1px at 73% 60%, rgba(255,214,140,0.75), transparent), radial-gradient(1px 1px at 79% 46%, rgba(255,214,140,0.65), transparent), radial-gradient(1px 1px at 70% 68%, rgba(255,214,140,0.55), transparent), radial-gradient(1px 1px at 82% 58%, rgba(255,214,140,0.5), transparent)",
                }}
              />

              {/* Liseré atmosphérique bleu fin */}
              <div
                className="absolute -inset-[1px] rounded-full"
                style={{
                  boxShadow:
                    "inset 0 0 34px 5px rgba(120,180,255,0.32), inset 0 0 3px 1px rgba(180,220,255,0.5), 0 0 46px 8px rgba(80,150,255,0.14)",
                }}
              />
            </div>

            <div className="relative flex flex-col items-center gap-8 lg:flex-row lg:items-center lg:justify-between">
              {/* Hologramme Hermès */}
              <div className="relative flex h-56 w-56 shrink-0 items-center justify-center sm:h-64 sm:w-64">
                {/* Halo externe maîtrisé */}
                <div className="absolute h-full w-full rounded-full bg-sky-400/15 blur-3xl" />

                {/* Sphère externe semi-transparente (1ère enveloppe) */}
                <span className="absolute inset-0 rounded-full border border-sky-200/[0.08]" />

                {/* Enveloppe intermédiaire (2e couche, profondeur) */}
                <span className="absolute inset-3 rounded-full border border-sky-200/[0.06] bg-sky-300/[0.02]" />

                {/* Maillage sphérique + nœuds de données */}
                <svg viewBox="0 0 200 200" className="absolute h-full w-full opacity-25">
                  <ellipse cx="100" cy="100" rx="90" ry="34" fill="none" stroke="#7dd3fc" strokeWidth="0.6" />
                  <ellipse cx="100" cy="100" rx="90" ry="34" fill="none" stroke="#7dd3fc" strokeWidth="0.6" transform="rotate(60 100 100)" />
                  <ellipse cx="100" cy="100" rx="90" ry="34" fill="none" stroke="#7dd3fc" strokeWidth="0.6" transform="rotate(120 100 100)" />
                  <circle cx="100" cy="100" r="90" fill="none" stroke="#7dd3fc" strokeWidth="0.6" />
                  <circle cx="10" cy="100" r="2" fill="#bae6fd" />
                  <circle cx="190" cy="100" r="2" fill="#bae6fd" />
                  <circle cx="100" cy="10" r="1.6" fill="#bae6fd" />
                  <circle cx="100" cy="190" r="1.6" fill="#bae6fd" />
                  <circle cx="26" cy="34" r="1.4" fill="#7dd3fc" />
                  <circle cx="174" cy="166" r="1.4" fill="#7dd3fc" />
                </svg>

                {/* Anneau de flux de données, pointillé, rotation continue */}
                <svg viewBox="0 0 200 200" className="absolute h-[92%] w-[92%] opacity-40" style={{ animation: "hos-ring-a 40s linear infinite" }}>
                  <circle cx="100" cy="100" r="96" fill="none" stroke="#7dd3fc" strokeWidth="1" strokeDasharray="2 10" style={{ animation: "hos-flow 6s linear infinite" }} />
                </svg>

                {/* Anneaux orbitaux, rotation lente et différenciée, plusieurs axes */}
                <span
                  className="absolute h-40 w-full rounded-full border border-sky-300/25"
                  style={{ animation: "hos-ring-a 22s linear infinite" }}
                />
                <span
                  className="absolute h-36 w-[85%] rounded-full border border-sky-300/20"
                  style={{ animation: "hos-ring-b 30s linear infinite" }}
                />
                <span className="absolute h-48 w-[70%] rounded-full border border-sky-200/10 [transform:rotate(58deg)]" />
                <span className="absolute h-44 w-[60%] rounded-full border border-sky-200/[0.08] [transform:rotate(-52deg)]" />

                {/* Cœur énergétique */}
                <div
                  className="relative flex h-32 w-32 items-center justify-center rounded-full border border-sky-300/40 bg-gradient-to-b from-sky-300/35 to-sky-600/20 shadow-[0_0_50px_rgba(56,189,248,0.25),0_0_110px_rgba(56,189,248,0.2),inset_0_0_45px_rgba(186,230,253,0.3)] sm:h-36 sm:w-36"
                  style={{ animation: "hos-core-pulse 4.5s ease-in-out infinite" }}
                >
                  {/* Filaments / circuits internes */}
                  <span className="absolute h-[1px] w-16 -rotate-12 bg-gradient-to-r from-transparent via-sky-100/40 to-transparent" />
                  <span className="absolute h-[1px] w-14 rotate-45 bg-gradient-to-r from-transparent via-sky-100/30 to-transparent" />
                  <span className="absolute h-[1px] w-10 rotate-[100deg] bg-gradient-to-r from-transparent via-sky-100/25 to-transparent" />
                  <span className="text-5xl font-semibold text-white sm:text-6xl">Σ</span>
                </div>

                {/* Particules / points de données, dérive très subtile */}
                <span className="absolute left-6 top-8 h-1 w-1 rounded-full bg-sky-200" style={{ animation: "hos-drift 6s ease-in-out infinite" }} />
                <span className="absolute right-8 top-14 h-1.5 w-1.5 rounded-full bg-sky-200/80" style={{ animation: "hos-drift 7s ease-in-out infinite 0.8s" }} />
                <span className="absolute bottom-10 left-12 h-1 w-1 rounded-full bg-sky-200/70" style={{ animation: "hos-drift 5.5s ease-in-out infinite 1.6s" }} />
                <span className="absolute bottom-14 right-10 h-1 w-1 rounded-full bg-sky-100/60" style={{ animation: "hos-drift 6.5s ease-in-out infinite 2.4s" }} />
                <span className="absolute top-6 right-16 h-[3px] w-[3px] rounded-full bg-sky-100/50" style={{ animation: "hos-drift 8s ease-in-out infinite 0.4s" }} />
                <span className="absolute left-3 bottom-20 h-1 w-1 rounded-full bg-sky-200/60" style={{ animation: "hos-drift 7.5s ease-in-out infinite 1.2s" }} />
                <span className="absolute right-4 top-24 h-1 w-1 rounded-full bg-sky-100/55" style={{ animation: "hos-drift 6.8s ease-in-out infinite 3s" }} />
              </div>

              {/* Statut + stats */}
              <div className="relative w-full max-w-xs text-center lg:text-left">
                <p className="text-xl font-semibold text-white">Hermès</p>
                <p className="text-sm text-slate-300">Directeur IA</p>
                <div className="mt-1.5 flex items-center justify-center gap-1.5 text-xs text-emerald-400 lg:justify-start">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </span>
                  En ligne
                </div>

                <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 text-left">
                  {heroStats.map((stat) => (
                    <div key={stat.label}>
                      <p className="text-2xl font-semibold text-white">{stat.value}</p>
                      <p className="text-xs text-slate-400">{stat.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Commande + actions rapides */}
          <div
            className={`mb-3 flex items-center gap-3 rounded-2xl border px-4 py-3 transition-shadow focus-within:ring-1 focus-within:ring-sky-400/40 ${panel}`}
          >
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="Demandez à Hermès ou lancez une action..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-500"
              aria-label="Commande Hermès"
            />
            <button
              aria-label="Envoyer la commande"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500 text-white transition-transform hover:scale-105"
            >
              <IconSend className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {quickActions.map(({ label, Icon, tint }) => (
              <button
                key={label}
                onClick={() => setCommand(label)}
                className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm transition-colors ${panel}`}
              >
                <span className={`flex h-6 w-6 items-center justify-center rounded-lg ${tint}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                {label}
              </button>
            ))}
          </div>

          {/* KPI */}
          <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {kpis.map((kpi, index) => (
              <div key={kpi.label} className={`rounded-2xl border p-4 ${panel}`}>
                <p className={`text-xs ${muted}`}>{kpi.label}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums tracking-[-0.03em]">{kpi.value}</p>
                <p className={`mt-1 text-xs font-medium ${kpi.color}`}>{kpi.delta}</p>
                <Sparkline path={sparkPaths[index]} stroke={kpi.stroke} />
              </div>
            ))}
          </section>

          {/* Tâches / Projets / Suggestions */}
          <div className="grid gap-5 lg:grid-cols-3">
            <section className={`rounded-2xl border p-5 ${panel}`}>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-medium">Tâches prioritaires</h3>
                <button className="text-xs font-medium text-sky-400">Voir tout</button>
              </div>
              <div className="space-y-4">
                {tasks.map((task) => (
                  <div key={task.title} className="flex items-start gap-3">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${taskDot[task.status]}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{task.title}</p>
                      <p className={`mt-0.5 text-xs ${subtle}`}>{task.time}</p>
                    </div>
                    <IconCheckCircle className={`h-4 w-4 shrink-0 ${subtle}`} />
                  </div>
                ))}
              </div>
            </section>

            <section className={`rounded-2xl border p-5 ${panel}`}>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-medium">Projets récents</h3>
                <button className="text-xs font-medium text-sky-400">Voir tout</button>
              </div>
              <div className="space-y-4">
                {projects.map((project) => (
                  <div key={project.name} className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 text-slate-300">
                      <IconBolt className="h-[18px] w-[18px]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm">{project.name}</p>
                        <span className={`text-xs ${muted}`}>{project.percent}%</span>
                      </div>
                      <p className={`text-xs ${subtle}`}>{project.detail}</p>
                      <div className={`mt-1.5 h-1 rounded-full ${dark ? "bg-white/10" : "bg-slate-200"}`}>
                        <div
                          className="h-1 rounded-full bg-gradient-to-r from-sky-400 to-cyan-300"
                          style={{ width: `${project.percent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className={`rounded-2xl border p-5 ${panel}`}>
              <h3 className="mb-4 font-medium">Suggestions IA</h3>
              <div className="space-y-3">
                {suggestions.map((suggestion) => {
                  const SuggestionIcon = suggestion.Icon;
                  return (
                    <button
                      key={suggestion.title}
                      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${panel}`}
                    >
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${suggestion.tint}`}>
                        <SuggestionIcon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{suggestion.title}</p>
                        <p className={`truncate text-xs ${subtle}`}>{suggestion.subtitle}</p>
                      </div>
                      <IconChevronRight className={`h-4 w-4 shrink-0 ${subtle}`} />
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

