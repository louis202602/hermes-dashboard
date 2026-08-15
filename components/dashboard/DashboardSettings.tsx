"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import {
  CONTEXT_SEGMENTS,
  LAYOUT_SCHEMA_VERSION,
  clampLayout,
  cycleWidgetSize,
  moveWidget,
  resolveContextConfig,
  resolveWidgetLayout,
  setWidgetHidden,
  setWidgetSize,
  widgetById,
  type ContextSegment,
  type LayoutPreferences,
  type WidgetCategory,
  type WidgetSize,
} from "@/lib/dashboard/widgets";

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

const CONTEXT_LABELS: Record<ContextSegment, string> = {
  time: "Heure",
  date: "Date",
  weather: "Météo",
  temperature: "Température",
  rain: "Pluie",
  wind: "Vent",
  location: "Localisation",
  cost: "Coût Hermès",
  alerts: "Alertes",
  nextEvent: "Prochain événement",
};

const CATEGORY_LABELS: Record<WidgetCategory, string> = {
  general: "Général",
  agenda: "Agenda",
  weather: "Météo",
  alerts: "Alertes",
  commercial: "Commercial",
  finance: "Finance",
  agents: "Agents",
  system: "Système",
  chantiers: "Chantiers",
  btp: "BTP",
  immobilier: "Immobilier",
};

const SIZE_SHORT: Record<string, string> = { small: "S", medium: "M", large: "L" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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
  availableWidgets = [],
}: {
  initial: DashboardPreferences;
  availableWidgets?: string[];
}) {
  const [appearance, setAppearance] = useState<Appearance>(initial.appearance);
  const [behavior, setBehavior] = useState<Behavior>(initial.behavior);
  const [regional, setRegional] = useState<RegionalOverride>(initial.regional);
  const [layout, setLayout] = useState<LayoutPreferences>(() =>
    clampLayout(initial.layout),
  );
  const version = useRef<number>(initial.version);
  const [save, setSave] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Record<string, unknown>>({});

  const availableSet = useMemo(
    () => new Set(availableWidgets),
    [availableWidgets],
  );

  // Unified optimistic persistence: patches (appearance/behavior/regional/layout)
  // accumulate and flush ONCE after a debounce — the replace-per-subobject upsert
  // preserves everything untouched. Shared version ⇒ no self-inflicted conflicts.
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setSave("saving");
    timer.current = setTimeout(async () => {
      const patch = {
        ...pending.current,
        schema_version: PREFERENCES_SCHEMA_VERSION,
      };
      pending.current = {};
      const res = await saveDashboardPreferencesAction(patch, version.current);
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
  }, []);

  const persistPatch = useCallback(
    (p: Record<string, unknown>) => {
      pending.current = { ...pending.current, ...p };
      schedule();
    },
    [schedule],
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
    persistPatch({ appearance: next });
  };
  const setB = (patch: Partial<Behavior>) => {
    const next = { ...behavior, ...patch };
    setBehavior(next);
    persistPatch({ behavior: next });
  };
  const setR = (patch: Partial<RegionalOverride>) => {
    const next = { ...regional, ...patch };
    setRegional(next);
    persistPatch({ regional: next });
  };
  const resetAppearance = () => {
    setAppearance(HERMES_DEFAULT_APPEARANCE);
    persistPatch({ appearance: HERMES_DEFAULT_APPEARANCE });
  };

  // --- DASH-4B widget layout ---
  const resolved = useMemo(
    () => resolveWidgetLayout(layout, availableSet),
    [layout, availableSet],
  );
  const ctx = useMemo(() => resolveContextConfig(layout.context), [layout]);

  const commitLayout = (next: LayoutPreferences) => {
    setLayout(next);
    persistPatch({ layout: next });
  };
  const onMove = (id: string, dir: -1 | 1) => {
    const base = resolved.items.map((it) => it.id);
    commitLayout({ ...layout, order: moveWidget(base, id, dir) });
  };
  const onHide = (id: string, hide: boolean) => {
    commitLayout({ ...layout, hidden: setWidgetHidden(layout.hidden, id, hide) });
  };
  const onSize = (id: string, size: WidgetSize) => {
    commitLayout({ ...layout, sizes: setWidgetSize(layout.sizes, id, size) });
  };
  // Add from the gallery: un-hide AND mark explicitly ordered (so an opt-in
  // widget like the map, hidden by default, becomes visible and stays visible).
  const onShow = (id: string) => {
    commitLayout({
      ...layout,
      order: resolved.items.map((it) => it.id),
      hidden: setWidgetHidden(layout.hidden, id, false),
    });
  };
  const onContext = (seg: ContextSegment, on: boolean) => {
    commitLayout({ ...layout, context: { ...layout.context, [seg]: on } });
  };
  const resetWidgets = () => {
    const cleared: LayoutPreferences = {
      order: [],
      hidden: [],
      sizes: {},
      context: {},
      schemaVersion: LAYOUT_SCHEMA_VERSION,
    };
    setLayout(cleared);
    persistPatch({ layout: cleared });
  };

  const activeItems = resolved.items.filter((it) => it.available && !it.hidden);
  const galleryItems = resolved.items.filter(
    (it) => !it.available || it.hidden,
  );

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

        <Section title="Widgets actifs">
          {activeItems.length === 0 ? (
            <p className="settings-reset-note">Aucun widget actif.</p>
          ) : (
            activeItems.map((it, idx) => (
              <div className="settings-row widget-row" key={it.id}>
                <span className="settings-row-label">{it.label}</span>
                <span className="widget-controls">
                  <button
                    type="button"
                    className="widget-btn"
                    aria-label={`Monter ${it.label}`}
                    disabled={idx === 0}
                    onClick={() => onMove(it.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="widget-btn"
                    aria-label={`Descendre ${it.label}`}
                    disabled={idx === activeItems.length - 1}
                    onClick={() => onMove(it.id, 1)}
                  >
                    ↓
                  </button>
                  {it.supportedSizes.length > 1 ? (
                    <button
                      type="button"
                      className="widget-btn"
                      aria-label={`Changer la taille de ${it.label} (actuelle : ${it.size})`}
                      onClick={() => onSize(it.id, cycleWidgetSize(it.id, it.size))}
                    >
                      {SIZE_SHORT[it.size]}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="widget-btn widget-btn-hide"
                    aria-label={`Masquer ${it.label}`}
                    onClick={() => onHide(it.id, true)}
                  >
                    Masquer
                  </button>
                </span>
              </div>
            ))
          )}
        </Section>

        <Section title="Ajouter un widget">
          {galleryItems.length === 0 ? (
            <p className="settings-reset-note">Tous les widgets disponibles sont actifs.</p>
          ) : (
            <div className="widget-gallery">
              {galleryItems.map((it) => {
                const def = widgetById(it.id);
                const sizes = (def?.supportedSizes ?? [])
                  .map((s) => SIZE_SHORT[s] ?? s)
                  .join(" · ");
                return (
                  <div
                    className={`widget-card${it.available ? "" : " is-unavailable"}`}
                    key={it.id}
                  >
                    <div className="widget-card-head">
                      <span className="widget-card-name">{it.label}</span>
                      <span className="widget-card-cat">
                        {CATEGORY_LABELS[it.category]}
                      </span>
                    </div>
                    <div className="widget-card-foot">
                      <span className="widget-card-sizes">{sizes}</span>
                      {it.available ? (
                        <button
                          type="button"
                          className="widget-btn widget-btn-add"
                          aria-label={`Ajouter ${it.label}`}
                          onClick={() => onShow(it.id)}
                        >
                          Ajouter
                        </button>
                      ) : (
                        <span className="widget-card-unavail">Non disponible</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <Section title="Barre de contexte">
          {CONTEXT_SEGMENTS.map((seg) => (
            <ToggleRow
              key={seg}
              label={CONTEXT_LABELS[seg]}
              checked={ctx[seg]}
              onChange={(v) => onContext(seg, v)}
            />
          ))}
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
          <button type="button" className="settings-reset" onClick={resetWidgets}>
            Restaurer les widgets par défaut
          </button>
          <p className="settings-reset-note">
            Réinitialise uniquement les widgets et la barre de contexte. L’apparence,
            le régional et le comportement ne sont pas touchés.
          </p>
        </Section>
      </div>
    </div>
  );
}
