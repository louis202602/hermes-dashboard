"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  type ContextSegment,
  type LayoutPreferences,
  type WidgetSize,
} from "@/lib/dashboard/widgets";
import { LANGUAGES, type MessageKey } from "@/lib/i18n/languages";
import { useI18n } from "@/lib/i18n/I18nProvider";

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";
type Opt = { value: string; label: string };

const SIZE_SHORT: Record<string, string> = { small: "S", medium: "M", large: "L" };

// Appearance option value lists (labels resolved via i18n at render).
const A_VALUES: Record<string, string[]> = {
  theme: ["dark", "light", "auto", "midnight", "graphite", "ocean", "solar", "minimal"],
  accent: ["blue", "cyan", "purple", "green", "orange", "red", "neutral"],
  contrast: ["standard", "high"],
  transparency: ["glass", "soft", "solid"],
  blur: ["none", "low", "standard", "high"],
  radius: ["small", "standard", "large"],
  shadow: ["none", "subtle", "standard"],
  font: ["hermes", "modern", "classic", "accessible"],
  textSize: ["compact", "standard", "large"],
  fontWeight: ["normal", "medium", "strong"],
  density: ["compact", "comfortable", "spacious"],
};
// opt.* key groups (textSize→size, fontWeight→weight); named themes keep literal names.
const OPT_GROUP: Record<string, string> = {
  accent: "accent",
  contrast: "contrast",
  transparency: "transparency",
  blur: "blur",
  radius: "radius",
  shadow: "shadow",
  font: "font",
  textSize: "size",
  fontWeight: "weight",
  density: "density",
};
const NAMED_THEMES: Record<string, string> = {
  midnight: "Midnight",
  graphite: "Graphite",
  ocean: "Ocean",
  solar: "Solar",
  minimal: "Minimal",
};

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
  const { t } = useI18n();
  const router = useRouter();
  const [appearance, setAppearance] = useState<Appearance>(initial.appearance);
  const [behavior, setBehavior] = useState<Behavior>(initial.behavior);
  const [regional, setRegional] = useState<RegionalOverride>(initial.regional);
  const [layout, setLayout] = useState<LayoutPreferences>(() => clampLayout(initial.layout));
  const version = useRef<number>(initial.version);
  const [save, setSave] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Record<string, unknown>>({});

  const availableSet = useMemo(() => new Set(availableWidgets), [availableWidgets]);

  // --- i18n-resolved option label helpers ---
  const themeLabel = (v: string): string =>
    v === "dark" ? t("opt.theme.dark")
    : v === "light" ? t("opt.theme.light")
    : v === "auto" ? t("settings.autoSystem")
    : NAMED_THEMES[v] ?? v;
  const optLabel = (group: string, v: string): string =>
    group === "theme" ? themeLabel(v) : t(`opt.${OPT_GROUP[group]}.${v}` as MessageKey);
  const opts = (group: string): Opt[] =>
    A_VALUES[group].map((v) => ({ value: v, label: optLabel(group, v) }));
  const INHERIT: Opt = { value: "", label: t("settings.inherit") };
  const codeOpts = (codes: string[]): Opt[] => [
    INHERIT,
    ...codes.map((v) => ({ value: v, label: v })),
  ];

  const R = {
    locale: codeOpts(["fr-FR", "fr-CA", "en-US", "en-GB", "es-ES", "de-DE", "it-IT", "pt-PT", "pt-BR", "nl-NL"]),
    country: codeOpts(["FR", "CA", "US", "GB", "ES", "DE", "IT", "PT", "BR", "NL", "BE", "CH"]),
    currency: codeOpts(["EUR", "USD", "GBP", "CHF", "CAD", "BRL"]),
    timezone: codeOpts(["Europe/Paris", "Europe/Madrid", "Europe/London", "America/New_York", "America/Los_Angeles", "America/Sao_Paulo", "Asia/Tokyo", "Asia/Dubai", "Australia/Sydney"]),
    temperatureUnit: [INHERIT, { value: "C", label: "°C" }, { value: "F", label: "°F" }],
    windUnit: [INHERIT, { value: "kmh", label: "km/h" }, { value: "mph", label: "mph" }],
    hourCycle: [{ value: "", label: t("settings.autoLocale") }, { value: "24h", label: t("opt.hour.24") }, { value: "12h", label: t("opt.hour.12") }],
    dateFormat: [{ value: "auto", label: t("settings.auto") }, { value: "short", label: t("opt.date.short") }, { value: "long", label: t("opt.date.long") }],
    firstDayOfWeek: [{ value: "auto", label: t("settings.auto") }, { value: "monday", label: t("opt.day.monday") }, { value: "sunday", label: t("opt.day.sunday") }],
    language: [INHERIT, ...LANGUAGES.map((l) => ({ value: l.code, label: l.label }))],
  };

  // Unified optimistic persistence (merged debounced patch — replace-per-subobject).
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setSave("saving");
    timer.current = setTimeout(async () => {
      const patch = { ...pending.current, schema_version: PREFERENCES_SCHEMA_VERSION };
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
  // Language change: persist immediately, then refresh so the server re-resolves the
  // UI catalog (robust, no divergence, only the active catalog ever reaches the client).
  const onLanguageChange = async (code: string) => {
    const next = { ...regional, language: code || null };
    setRegional(next);
    setSave("saving");
    const res = await saveDashboardPreferencesAction(
      { regional: next, schema_version: PREFERENCES_SCHEMA_VERSION },
      version.current,
    );
    if (res.ok && typeof res.version === "number") {
      version.current = res.version;
      setSave("saved");
      router.refresh();
    } else if (res.status === "VERSION_CONFLICT") {
      setSave("conflict");
      setTimeout(() => window.location.reload(), 1400);
    } else {
      setSave("error");
    }
  };
  const resetAppearance = () => {
    setAppearance(HERMES_DEFAULT_APPEARANCE);
    persistPatch({ appearance: HERMES_DEFAULT_APPEARANCE });
  };

  const resolved = useMemo(() => resolveWidgetLayout(layout, availableSet), [layout, availableSet]);
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
    const cleared: LayoutPreferences = { order: [], hidden: [], sizes: {}, context: {}, schemaVersion: LAYOUT_SCHEMA_VERSION };
    setLayout(cleared);
    persistPatch({ layout: cleared });
  };

  const activeItems = resolved.items.filter((it) => it.available && !it.hidden);
  const galleryItems = resolved.items.filter((it) => !it.available || it.hidden);
  const widgetName = (id: string) => t(`widget.${id}` as MessageKey);
  const segLabel = (seg: ContextSegment) => t(`seg.${seg}` as MessageKey);

  const saveLabel =
    save === "saving" ? t("common.save.saving")
    : save === "saved" ? t("common.save.saved")
    : save === "conflict" ? t("common.save.conflict")
    : save === "error" ? t("common.save.error")
    : "";

  return (
    <div className="settings-page">
      <header className="settings-header">
        <div>
          <span className="panel-eyebrow">{t("settings.eyebrow")}</span>
          <h2>{t("settings.title")}</h2>
        </div>
        <div className="settings-header-right">
          <span className={`settings-savestate is-${save}`} aria-live="polite">{saveLabel}</span>
          <Link href="/" className="settings-back">← {t("common.back")}</Link>
        </div>
      </header>

      <div className="settings-body">
        <Section title={t("settings.section.appearance")}>
          <SelectRow label={t("settings.row.theme")} value={appearance.theme} options={opts("theme")} onChange={(v) => setA({ theme: v as Appearance["theme"] })} />
          <SelectRow label={t("settings.row.accent")} value={appearance.accent} options={opts("accent")} onChange={(v) => setA({ accent: v as Appearance["accent"] })} />
          <SelectRow label={t("settings.row.contrast")} value={appearance.contrast} options={opts("contrast")} onChange={(v) => setA({ contrast: v as Appearance["contrast"] })} />
          <SelectRow label={t("settings.row.transparency")} value={appearance.transparency} options={opts("transparency")} onChange={(v) => setA({ transparency: v as Appearance["transparency"] })} />
          <SelectRow label={t("settings.row.blur")} value={appearance.blur} options={opts("blur")} onChange={(v) => setA({ blur: v as Appearance["blur"] })} />
          <SelectRow label={t("settings.row.radius")} value={appearance.radius} options={opts("radius")} onChange={(v) => setA({ radius: v as Appearance["radius"] })} />
          <SelectRow label={t("settings.row.shadow")} value={appearance.shadow} options={opts("shadow")} onChange={(v) => setA({ shadow: v as Appearance["shadow"] })} />
        </Section>

        <Section title={t("settings.section.text")}>
          <SelectRow label={t("settings.row.font")} value={appearance.font} options={opts("font")} onChange={(v) => setA({ font: v as Appearance["font"] })} />
          <SelectRow label={t("settings.row.textSize")} value={appearance.textSize} options={opts("textSize")} onChange={(v) => setA({ textSize: v as Appearance["textSize"] })} />
          <SelectRow label={t("settings.row.fontWeight")} value={appearance.fontWeight} options={opts("fontWeight")} onChange={(v) => setA({ fontWeight: v as Appearance["fontWeight"] })} />
          <SelectRow label={t("settings.row.density")} value={appearance.density} options={opts("density")} onChange={(v) => setA({ density: v as Appearance["density"] })} />
        </Section>

        <Section title={t("settings.section.accessibility")}>
          <ToggleRow label={t("settings.row.highContrast")} checked={appearance.contrast === "high"} onChange={(v) => setA({ contrast: v ? "high" : "standard" })} />
          <ToggleRow label={t("settings.row.reduceMotion")} checked={appearance.reduceMotion} onChange={(v) => setA({ reduceMotion: v })} />
          <ToggleRow label={t("settings.row.reduceTransparency")} checked={appearance.reduceTransparency} onChange={(v) => setA({ reduceTransparency: v })} />
          <ToggleRow label={t("settings.row.comfortableDensity")} checked={appearance.density === "comfortable"} onChange={(v) => setA({ density: v ? "comfortable" : "compact" })} />
        </Section>

        <Section title={t("settings.section.behavior")}>
          <ToggleRow label={t("settings.row.sidebarCollapsed")} checked={behavior.sidebarCollapsed} onChange={(v) => setB({ sidebarCollapsed: v })} />
          <ToggleRow label={t("settings.row.animations")} checked={behavior.animations} onChange={(v) => setB({ animations: v })} />
        </Section>

        <Section title={t("settings.section.activeWidgets")}>
          {activeItems.length === 0 ? (
            <p className="settings-reset-note">{t("settings.widgets.none")}</p>
          ) : (
            activeItems.map((it, idx) => (
              <div className="settings-row widget-row" key={it.id}>
                <span className="settings-row-label">{widgetName(it.id)}</span>
                <span className="widget-controls">
                  <button type="button" className="widget-btn" aria-label={t("settings.widget.moveUp", { name: widgetName(it.id) })} disabled={idx === 0} onClick={() => onMove(it.id, -1)}>↑</button>
                  <button type="button" className="widget-btn" aria-label={t("settings.widget.moveDown", { name: widgetName(it.id) })} disabled={idx === activeItems.length - 1} onClick={() => onMove(it.id, 1)}>↓</button>
                  {it.supportedSizes.length > 1 ? (
                    <button type="button" className="widget-btn" aria-label={t("settings.widget.resize", { name: widgetName(it.id), size: it.size })} onClick={() => onSize(it.id, cycleWidgetSize(it.id, it.size))}>{SIZE_SHORT[it.size]}</button>
                  ) : null}
                  <button type="button" className="widget-btn widget-btn-hide" aria-label={t("settings.widget.hide", { name: widgetName(it.id) })} onClick={() => onHide(it.id, true)}>{t("settings.widget.masquer")}</button>
                </span>
              </div>
            ))
          )}
        </Section>

        <Section title={t("settings.section.addWidget")}>
          {galleryItems.length === 0 ? (
            <p className="settings-reset-note">{t("settings.widgets.allActive")}</p>
          ) : (
            <div className="widget-gallery">
              {galleryItems.map((it) => {
                const sizes = it.supportedSizes.map((s) => SIZE_SHORT[s] ?? s).join(" · ");
                return (
                  <div className={`widget-card${it.available ? "" : " is-unavailable"}`} key={it.id}>
                    <div className="widget-card-head">
                      <span className="widget-card-name">{widgetName(it.id)}</span>
                      <span className="widget-card-cat">{t(`cat.${it.category}` as MessageKey)}</span>
                    </div>
                    <div className="widget-card-foot">
                      <span className="widget-card-sizes">{sizes}</span>
                      {it.available ? (
                        <button type="button" className="widget-btn widget-btn-add" aria-label={t("settings.widget.add", { name: widgetName(it.id) })} onClick={() => onShow(it.id)}>{t("settings.widget.ajouter")}</button>
                      ) : (
                        <span className="widget-card-unavail">{t("settings.widget.unavailable")}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <Section title={t("settings.section.contextBar")}>
          {CONTEXT_SEGMENTS.map((seg) => (
            <ToggleRow key={seg} label={segLabel(seg)} checked={ctx[seg]} onChange={(v) => onContext(seg, v)} />
          ))}
        </Section>

        <Section title={t("settings.section.regional")}>
          <SelectRow label={t("settings.row.language")} value={regional.language ?? ""} options={R.language} onChange={(v) => onLanguageChange(v)} />
          <SelectRow label={t("settings.row.locale")} value={regional.locale ?? ""} options={R.locale} onChange={(v) => setR({ locale: v || null })} />
          <SelectRow label={t("settings.row.country")} value={regional.country ?? ""} options={R.country} onChange={(v) => setR({ country: v || null })} />
          <SelectRow label={t("settings.row.currency")} value={regional.currency ?? ""} options={R.currency} onChange={(v) => setR({ currency: v || null })} />
          <SelectRow label={t("settings.row.timezone")} value={regional.timezone ?? ""} options={R.timezone} onChange={(v) => setR({ timezone: v || null })} />
          <SelectRow label={t("settings.row.temperature")} value={regional.temperatureUnit ?? ""} options={R.temperatureUnit} onChange={(v) => setR({ temperatureUnit: (v || null) as RegionalOverride["temperatureUnit"] })} />
          <SelectRow label={t("settings.row.wind")} value={regional.windUnit ?? ""} options={R.windUnit} onChange={(v) => setR({ windUnit: (v || null) as RegionalOverride["windUnit"] })} />
          <SelectRow label={t("settings.row.hourCycle")} value={regional.hourCycle ?? ""} options={R.hourCycle} onChange={(v) => setR({ hourCycle: (v || null) as RegionalOverride["hourCycle"] })} />
          <ToggleRow label={t("settings.row.showSeconds")} checked={regional.showSeconds} onChange={(v) => setR({ showSeconds: v })} />
          <SelectRow label={t("settings.row.dateFormat")} value={regional.dateFormat} options={R.dateFormat} onChange={(v) => setR({ dateFormat: v as RegionalOverride["dateFormat"] })} />
          <SelectRow label={t("settings.row.firstDayOfWeek")} value={regional.firstDayOfWeek} options={R.firstDayOfWeek} onChange={(v) => setR({ firstDayOfWeek: v as RegionalOverride["firstDayOfWeek"] })} />
        </Section>

        <Section title={t("settings.section.reset")}>
          <button type="button" className="settings-reset" onClick={resetAppearance}>{t("settings.reset.appearance")}</button>
          <p className="settings-reset-note">{t("settings.reset.appearance.note")}</p>
          <button type="button" className="settings-reset" onClick={resetWidgets}>{t("settings.reset.widgets")}</button>
          <p className="settings-reset-note">{t("settings.reset.widgets.note")}</p>
        </Section>
      </div>
    </div>
  );
}
