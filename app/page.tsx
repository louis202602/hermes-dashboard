"use client";

import { useState } from "react";

const navigation = [
  ["⌂", "Tableau de bord"],
  ["✦", "Hermès IA"],
  ["◎", "Prospects"],
  ["▱", "Projets"],
  ["✓", "Tâches"],
  ["▥", "Rapports"],
];

const kpis = [
  ["Chiffre d’affaires", "184 240 €", "+12,8 %", "text-cyan-300"],
  ["Prospects actifs", "48", "+8 cette semaine", "text-emerald-300"],
  ["Devis en attente", "12", "4 à relancer", "text-amber-300"],
  ["Tâches prioritaires", "07", "Aujourd’hui", "text-rose-300"],
];

const tasks = [
  ["Relancer le devis Villa Serena", "Aujourd’hui · 10:30", "Haute"],
  ["Préparer la visite technique Martin", "Aujourd’hui · 14:00", "Moyenne"],
  ["Envoyer le rapport de production", "Demain · 09:00", "Normale"],
];

const projects = [
  ["Résidence Les Oliviers", "Installation photovoltaïque", "78 %", "bg-cyan-400"],
  ["Atelier du Prado", "Étude autoconsommation", "42 %", "bg-amber-300"],
  ["Maison Calanques", "Suivi de chantier", "91 %", "bg-emerald-300"],
];

export default function Home() {
  const [isDark, setIsDark] = useState(true);
  const [activePage, setActivePage] = useState("Tableau de bord");
  const [command, setCommand] = useState("");
  const dark = isDark;
  const panel = dark ? "border-white/10 bg-white/[0.045]" : "border-slate-200 bg-white/80";
  const muted = dark ? "text-slate-400" : "text-slate-500";
  const subtle = dark ? "text-slate-500" : "text-slate-400";

  return (
    <main className={dark ? "min-h-screen bg-[#071321] text-slate-100" : "min-h-screen bg-[#f3f7fb] text-[#16253b]"}>
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_65%_18%,rgba(33,112,174,0.16),transparent_30%),radial-gradient(circle_at_25%_85%,rgba(22,157,157,0.08),transparent_25%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-[1600px] flex-col lg:flex-row">
        <aside className={dark ? "flex w-full shrink-0 flex-col border-b border-white/10 bg-[#091827]/85 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r" : "flex w-full shrink-0 flex-col border-b border-slate-200 bg-white/85 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r"}>
          <div className="flex items-center justify-between px-6 py-6 lg:block lg:px-7 lg:py-8">
            <div><p className="text-[11px] font-bold tracking-[0.3em] text-cyan-400">HERMÈS OS</p><p className={`mt-2 text-xs ${muted}`}>HelioSolar Intelligence</p></div>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-400/10 text-lg text-cyan-300 lg:mt-7">Σ</div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-4 pb-4 lg:block lg:space-y-1 lg:px-3">
            {navigation.map(([icon, label]) => <button key={label} onClick={() => setActivePage(label)} className={`flex min-w-max items-center gap-3 rounded-xl px-4 py-3 text-sm transition lg:w-full ${activePage === label ? "bg-cyan-400/10 font-medium text-cyan-300" : `${muted} hover:bg-white/5 hover:text-cyan-200`}`}><span className="w-5 text-center text-base">{icon}</span>{label}</button>)}
          </nav>
          <div className={`mt-auto hidden border-t p-5 lg:block ${dark ? "border-white/10" : "border-slate-200"}`}>
            <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-300 font-semibold text-[#082039]">LP</div><div><p className="text-sm font-medium">Louis Preira</p><p className={`text-xs ${subtle}`}>Administrateur</p></div><span className="ml-auto h-2 w-2 rounded-full bg-emerald-400" /></div>
            <div className={`mt-5 flex items-center gap-2 text-xs ${muted}`}><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Système en ligne</div>
          </div>
        </aside>
        <section className="min-w-0 flex-1 px-5 py-6 sm:px-8 lg:px-10 lg:py-9">
          <header className="mb-7 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div><p className={`mb-2 text-xs uppercase tracking-[0.2em] ${subtle}`}>Mercredi 22 juillet 2026</p><h1 className="text-3xl font-medium tracking-[-0.04em] sm:text-4xl">Bonjour Louis</h1><p className={`mt-3 text-sm ${muted}`}>Voici ce qui mérite votre attention aujourd’hui.</p></div>
            <div className="flex flex-wrap items-center gap-2"><div className={`flex h-10 items-center gap-3 rounded-xl border px-3 text-sm ${panel}`}><span className="text-lg">☀</span><span className={muted}>Marseille</span><span>29 °C</span></div><button aria-label="Afficher les notifications" className={`relative h-10 w-10 rounded-xl border text-lg ${panel} ${muted}`}>♧<span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-cyan-400" /></button><button aria-label={dark ? "Activer le mode clair" : "Activer le mode sombre"} onClick={() => setIsDark(!dark)} className={`h-10 w-10 rounded-xl border text-lg ${panel} ${dark ? "text-amber-300" : "text-slate-500"}`}>{dark ? "☼" : "☾"}</button></div>
          </header>
          <label className={`mb-6 flex h-11 max-w-xl items-center gap-3 rounded-xl border px-4 text-sm ${panel} ${muted}`}><span>⌕</span><input aria-label="Rechercher" type="search" placeholder="Rechercher dans Hermès..." className="w-full bg-transparent outline-none placeholder:text-inherit" /><span className="hidden rounded border border-current/20 px-1.5 py-0.5 text-[10px] sm:block">⌘ K</span></label>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.85fr)]">
            <section className={`relative min-h-[450px] overflow-hidden rounded-2xl border p-7 sm:p-10 ${panel}`}><div className="absolute -right-24 -top-28 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" /><div className="relative flex h-full flex-col items-center justify-center text-center"><div className="relative flex h-36 w-36 items-center justify-center rounded-full border border-cyan-300/40 bg-cyan-300/10 shadow-[0_0_70px_rgba(34,211,238,0.16)]"><div className="flex h-24 w-24 items-center justify-center rounded-full bg-cyan-300 text-4xl font-semibold text-[#082039]">Σ</div><span className="absolute inset-[-18px] rounded-full border border-cyan-300/15" /></div><p className="mt-8 text-[11px] font-bold uppercase tracking-[0.3em] text-cyan-400">Hermès IA</p><h2 className="mt-3 text-2xl font-medium tracking-[-0.035em] sm:text-3xl">Comment puis-je vous aider aujourd’hui ?</h2><p className={`mt-3 max-w-md text-sm ${muted}`}>Analysez votre activité, préparez une action ou demandez une synthèse à votre intelligence opérationnelle.</p><div className={`mt-7 flex w-full max-w-lg items-center gap-3 rounded-xl border px-4 py-3 ${dark ? "border-white/10 bg-black/15" : "border-slate-200 bg-white"}`}><input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Écrivez une commande à Hermès..." className="w-full bg-transparent text-sm outline-none placeholder:text-slate-500" aria-label="Commande Hermès" /><button aria-label="Envoyer la commande" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-300 text-[#082039]">↑</button></div><div className="mt-4 flex flex-wrap justify-center gap-2">{["Nouveau prospect", "Créer un devis", "Analyser une facture", "Voir les tâches"].map((action) => <button key={action} onClick={() => setCommand(action)} className={`rounded-lg border px-3 py-2 text-xs ${dark ? "border-white/10 text-slate-300 hover:border-cyan-300/50" : "border-slate-200 text-slate-600 hover:border-cyan-400"}`}>{action}</button>)}</div></div></section>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2">{kpis.map(([label, value, detail, color]) => <div key={label} className={`rounded-2xl border p-5 ${panel}`}><div className={`mb-5 h-2 w-2 rounded-full ${color.replace("text-", "bg-")}`} /><p className={`text-xs ${muted}`}>{label}</p><p className="mt-2 text-2xl font-medium tracking-[-0.04em]">{value}</p><p className={`mt-2 text-xs ${color}`}>{detail}</p></div>)}</section>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_1fr_0.9fr]">
            <section className={`rounded-2xl border p-5 ${panel}`}><div className="mb-4 flex items-center justify-between"><h3 className="font-medium">Tâches prioritaires</h3><button className="text-xs text-cyan-300">Voir tout</button></div><div className="space-y-4">{tasks.map(([title, time, priority]) => <div key={title} className="flex gap-3"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-rose-300" /><div className="min-w-0"><p className="truncate text-sm">{title}</p><p className={`mt-1 text-xs ${subtle}`}>{time}<span className="mx-1">·</span>{priority}</p></div></div>)}</div></section>
            <section className={`rounded-2xl border p-5 ${panel}`}><div className="mb-4 flex items-center justify-between"><h3 className="font-medium">Projets récents</h3><button className="text-xs text-cyan-300">Voir tout</button></div><div className="space-y-4">{projects.map(([name, type, progress, color]) => <div key={name}><div className="flex justify-between gap-3 text-sm"><span className="truncate">{name}</span><span className={`text-xs ${muted}`}>{progress}</span></div><p className={`mt-1 text-xs ${subtle}`}>{type}</p><div className={`mt-3 h-1 rounded-full ${dark ? "bg-white/10" : "bg-slate-200"}`}><div className={`h-1 rounded-full ${color}`} style={{ width: progress }} /></div></div>)}</div></section>
            <section className={`rounded-2xl border p-5 ${panel}`}><h3 className="font-medium">Suggestions d’Hermès</h3><div className={`mt-4 space-y-3 text-sm ${muted}`}><p className="border-l-2 border-cyan-300 pl-3">4 prospects sont prêts pour une relance.</p><p className="border-l-2 border-amber-300 pl-3">Le devis Martin attend votre validation.</p><p className="border-l-2 border-emerald-300 pl-3">Votre rapport mensuel est disponible.</p></div></section>
          </div>
        </section>
      </div>
    </main>
  );
}
