"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { saveDashboardPreferencesAction } from "@/app/actions/dashboard-preferences";
import {
  applyAppearance,
  effectiveAppearance,
  writeAppearanceCookie,
} from "@/lib/dashboard/applyAppearance";
import {
  HERMES_DEFAULT_APPEARANCE,
  PREFERENCES_SCHEMA_VERSION,
  type Appearance,
  type Behavior,
  type DashboardPreferences,
  type RegionalOverride,
} from "@/lib/dashboard/preferences";

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

type Opt = { value: string; label: string };

const A: Record<string, Opt[]> = {
  theme: [
    { value: "dark", label: "Hermès Sombre" },
    { value: "light", label: "Hermès Clair" },
    { value: "auto", label: "Automatique (système)" },
    { value: "midnight", label: "Midnight" },
    { value: "graphite", label: "Graphite" },
    { value: "ocean", label: "Ocean" },
    { value: "solar", label: "Solar" },
    { value: "minimal", label: "Minimal" },
  ],
  accent: [
    { value: "blue", label: "Bleu" },
    { value: "cyan", label: "Cyan" },
    { value: "purple", label: "Violet" },
    { value: "green", label: "Vert" },
    { value: "orange", label: "Orange" },
    { value: "red", label: "Rouge" },
    { value: "neutral", label: "Neutre" },
  ],
  contrast: [
    { value: "standard", label: "Standard" },
    { value: "high", label: "Renforcé" },
  ],
  transparency: [
    { value: "glass", label: "Verre" },
    { value: "soft", label: "Doux" },
    { value: "solid", label: "Opaque" },
  ],
  blur: [
    { value: "none", label: "Aucun" },
    { value: "low", label: "Faible" },
    { value: "standard", label: "Standard" },
    { value: "high", label: "Élevé" },
  ],
  radius: [
    { value: "small", label: "Petits" },
    { value: "standard", label: "Standard" },
    { value: "large", label: "Larges" },
  ],
  shadow: [
    { value: "none", label: "Aucune" },
    { value: "subtle", label: "Subtile" },
    { value: "standard", label: "Standard" },
  ],
  font: [
    { value: "hermes", label: "Hermès" },
    { value: "modern", label: "Moderne" },
    { value: "classic", label: "Classique" },
    { value: "accessible", label: "Accessible" },
  ],
  textSize: [
    { value: "compact", label: "Compact" },
    { value: "standard", label: "Standard" },
    { value: "large", label: "Large" },
  ],
  fontWeight: [
    { value: "normal", label: "Normale" },
    { value: "medium", label: "Moyenne" },
    { value: "strong", label: "Forte" },
  ],
  density: [
    { value: "compact", label: "Compact" },
    { value: "comfortable", label: "Confortable" },
    { value: "spacious", label: "Spacieux" },
  ],
};

const INHERIT = { value: "", label: "Hérité (tenant)" };
const R: Record<string, Opt[]> = {
  locale: [INHERIT, ...["fr-FR", "fr-CA", "en-US", "en-GB", "es-ES", "de-DE", "it-IT", "pt-PT", "pt-BR", "nl-NL"].map((v) => ({ value: v, label: v }))],
  country: [INHERIT, ...["FR", "CA", "US", "GB", "ES", "DE", "IT", "PT", "BR", "NL", "BE", "CH"].map((v) => ({ value: v, label: v }))],
  currency: [INHERIT, ...["EUR", "USD", "GBP", "CHF", "CAD", "BRL"].map((v) => ({ value: v, label: v }))],
  timezone: [INHERIT, ...["Europe/Paris", "Europe/Madrid", "Europe/London", "America/New_York", "America/Los_Angeles", "America/Sao_Paulo", "Asia/Tokyo", "Asia/Dubai", "Australia/Sydney"].map((v) => ({ value: v, label: v }))],
  temperatureUnit: [INHERIT, { value: "C", label: "°C" }, { value: "F", label: "°F" }],
  windUnit: [INHERIT, { value: "kmh", label: "km/h" }, { value: "mph", label: "mph" }],
  hourCycle: [{ value: "", label: "Auto (locale)" }, { value: "24h", label: "24 h" }, { value: "12h", label: "12 h" }],
  dateFormat: [{ value: "auto", label: "Auto" }, { value: "short", label: "Court" }, { value: "long", label: "Long" }],
  firstDayOfWeek: [{ value: "auto", label: "Auto" }, { value: "monday", label: "Lundi" }, { value: "sunday", label: "Dimanche" }],
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  // Native <details>: open two-pane on desktop; on mobile each section is a real
  // collapsible drill-in (keyboard + touch accessible, no JS) instead of one long scroll.
  return (
    <details className="settings-section" open>
      <summary className="settings-section-title">{title}</summary>
      <div className="settings-group">{children}</div>
    </details>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Opt[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="settings-row">
      <span className="settings-row-label">{label}</span>
      <select
        className="settings-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="settings-row">
      <span className="settings-row-label">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`settings-switch${checked ? " is-on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="settings-switch-knob" />
      </button>
    </label>
  );
}

export default function DashboardSettings({
  initial,
}: {
  initial: DashboardPreferences;
}) {
  const [appearance, setAppearance] = useState<Appearance>(initial.appearance);
  const [behavior, setBehavior] = useState<Behavior>(initial.behavior);
  const [regional, setRegional] = useState<RegionalOverride>(initial.regional);
  const version = useRef<number>(initial.version);
  const [save, setSave] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(
    (a: Appearance, b: Behavior, r: RegionalOverride) => {
      if (timer.current) clearTimeout(timer.current);
      setSave("saving");
      timer.current = setTimeout(async () => {
        const res = await saveDashboardPreferencesAction(
          {
            appearance: a,
            behavior: b,
            regional: r,
            schema_version: PREFERENCES_SCHEMA_VERSION,
          },
          version.current,
        );
        if (res.ok && typeof res.version === "number") {
          version.current = res.version;
          setSave("saved");
        } else if (res.status === "VERSION_CONFLICT") {
          setSave("conflict");
          setTimeout(() => window.location.reload(), 1400);
        } else {
          setSave("error");
        }
      }, 600);
    },
    [],
  );

  // Live preview: reflect appearance on <html> as it changes.
  useEffect(() => {
    const eff = effectiveAppearance(appearance, behavior);
    applyAppearance(eff);
    writeAppearanceCookie(eff);
  }, [appearance, behavior]);

  const setA = (patch: Partial<Appearance>) => {
    const next = { ...appearance, ...patch };
    setAppearance(next);
    persist(next, behavior, regional);
  };
  const setB = (patch: Partial<Behavior>) => {
    const next = { ...behavior, ...patch };
    setBehavior(next);
    persist(appearance, next, regional);
  };
  const setR = (patch: Partial<RegionalOverride>) => {
    const next = { ...regional, ...patch };
    setRegional(next);
    persist(appearance, behavior, next);
  };
  const resetAppearance = () => {
    setAppearance(HERMES_DEFAULT_APPEARANCE);
    persist(HERMES_DEFAULT_APPEARANCE, behavior, regional);
  };

  const saveLabel =
    save === "saving"
      ? "Synchronisation…"
      : save === "saved"
        ? "Enregistré"
        : save === "conflict"
          ? "Conflit — rechargement…"
          : save === "error"
            ? "Erreur d’enregistrement"
            : "";

  return (
    <div className="settings-page">
      <header className="settings-header">
        <div>
          <span className="panel-eyebrow">PARAMÈTRES</span>
          <h2>Dashboard</h2>
        </div>
        <div className="settings-header-right">
          <span className={`settings-savestate is-${save}`} aria-live="polite">
            {saveLabel}
          </span>
          <Link href="/" className="settings-back">
            ← Retour
          </Link>
        </div>
      </header>

      <div className="settings-body">
        <Section title="Apparence">
          <SelectRow label="Thème" value={appearance.theme} options={A.theme} onChange={(v) => setA({ theme: v as Appearance["theme"] })} />
          <SelectRow label="Couleur d’accent" value={appearance.accent} options={A.accent} onChange={(v) => setA({ accent: v as Appearance["accent"] })} />
          <SelectRow label="Contraste" value={appearance.contrast} options={A.contrast} onChange={(v) => setA({ contrast: v as Appearance["contrast"] })} />
          <SelectRow label="Transparence des cartes" value={appearance.transparency} options={A.transparency} onChange={(v) => setA({ transparency: v as Appearance["transparency"] })} />
          <SelectRow label="Flou (blur)" value={appearance.blur} options={A.blur} onChange={(v) => setA({ blur: v as Appearance["blur"] })} />
          <SelectRow label="Coins arrondis" value={appearance.radius} options={A.radius} onChange={(v) => setA({ radius: v as Appearance["radius"] })} />
          <SelectRow label="Ombres" value={appearance.shadow} options={A.shadow} onChange={(v) => setA({ shadow: v as Appearance["shadow"] })} />
        </Section>

        <Section title="Texte">
          <SelectRow label="Police" value={appearance.font} options={A.font} onChange={(v) => setA({ font: v as Appearance["font"] })} />
          <SelectRow label="Taille du texte" value={appearance.textSize} options={A.textSize} onChange={(v) => setA({ textSize: v as Appearance["textSize"] })} />
          <SelectRow label="Graisse" value={appearance.fontWeight} options={A.fontWeight} onChange={(v) => setA({ fontWeight: v as Appearance["fontWeight"] })} />
          <SelectRow label="Densité" value={appearance.density} options={A.density} onChange={(v) => setA({ density: v as Appearance["density"] })} />
        </Section>

        <Section title="Accessibilité">
          <ToggleRow label="Contraste renforcé" checked={appearance.contrast === "high"} onChange={(v) => setA({ contrast: v ? "high" : "standard" })} />
          <ToggleRow label="Réduire les animations" checked={appearance.reduceMotion} onChange={(v) => setA({ reduceMotion: v })} />
          <ToggleRow label="Réduire la transparence" checked={appearance.reduceTransparency} onChange={(v) => setA({ reduceTransparency: v })} />
          <ToggleRow label="Densité confortable" checked={appearance.density === "comfortable"} onChange={(v) => setA({ density: v ? "comfortable" : "compact" })} />
        </Section>

        <Section title="Comportement">
          <ToggleRow label="Sidebar réduite" checked={behavior.sidebarCollapsed} onChange={(v) => setB({ sidebarCollapsed: v })} />
          <ToggleRow label="Animations" checked={behavior.animations} onChange={(v) => setB({ animations: v })} />
        </Section>

        <Section title="Régional / Heure">
          <SelectRow label="Locale" value={regional.locale ?? ""} options={R.locale} onChange={(v) => setR({ locale: v || null })} />
          <SelectRow label="Pays" value={regional.country ?? ""} options={R.country} onChange={(v) => setR({ country: v || null })} />
          <SelectRow label="Devise" value={regional.currency ?? ""} options={R.currency} onChange={(v) => setR({ currency: v || null })} />
          <SelectRow label="Fuseau horaire" value={regional.timezone ?? ""} options={R.timezone} onChange={(v) => setR({ timezone: v || null })} />
          <SelectRow label="Température" value={regional.temperatureUnit ?? ""} options={R.temperatureUnit} onChange={(v) => setR({ temperatureUnit: (v || null) as RegionalOverride["temperatureUnit"] })} />
          <SelectRow label="Vent" value={regional.windUnit ?? ""} options={R.windUnit} onChange={(v) => setR({ windUnit: (v || null) as RegionalOverride["windUnit"] })} />
          <SelectRow label="Format heure" value={regional.hourCycle ?? ""} options={R.hourCycle} onChange={(v) => setR({ hourCycle: (v || null) as RegionalOverride["hourCycle"] })} />
          <ToggleRow label="Afficher les secondes" checked={regional.showSeconds} onChange={(v) => setR({ showSeconds: v })} />
          <SelectRow label="Format de date" value={regional.dateFormat} options={R.dateFormat} onChange={(v) => setR({ dateFormat: v as RegionalOverride["dateFormat"] })} />
          <SelectRow label="Premier jour de semaine" value={regional.firstDayOfWeek} options={R.firstDayOfWeek} onChange={(v) => setR({ firstDayOfWeek: v as RegionalOverride["firstDayOfWeek"] })} />
        </Section>

        <Section title="Réinitialisation">
          <button type="button" className="settings-reset" onClick={resetAppearance}>
            Restaurer l’apparence par défaut
          </button>
          <p className="settings-reset-note">
            Réinitialise uniquement l’apparence (thème, accent, texte…). Les widgets
            et réglages régionaux ne sont pas touchés.
          </p>
        </Section>
      </div>
    </div>
  );
}
