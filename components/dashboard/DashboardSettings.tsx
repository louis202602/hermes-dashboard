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
  WIDGET_REGISTRY,
  type ContextSegment,
  type LayoutPreferences,
  type WidgetSize,
} from "@/lib/dashboard/widgets";
import {
  MAX_QUICK_ACTIONS,
  NAV_SHORTCUTS,
  favoriteNavRef,
  favoriteWidgetRef,
  isValidDefaultHome,
  toggleFavorite,
} from "@/lib/dashboard/shortcuts";
import {
  PROFILE_IDS,
  clampProfiles,
  renameProfile,
  resetProfile,
  resolveActiveProfile,
  setActiveProfile,
  setProfileAppearance,
  setProfileWallpaper,
  type ProfileId,
  type ProfilesState,
} from "@/lib/dashboard/profiles";
import {
  WALLPAPER_POSITIONS,
  isUserWallpaperRef,
  wallpapersByCategory,
  type WallpaperCategory,
  type WallpaperPosition,
} from "@/lib/dashboard/wallpapers";
import { deleteWallpaperAction, uploadWallpaperAction } from "@/app/actions/wallpaper";
import { encodeImageFileToJpeg } from "@/lib/attachments/browserImage";
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

function ChipToggle({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`settings-chip${active ? " is-active" : ""}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
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
  capabilities = [],
}: {
  initial: DashboardPreferences;
  availableWidgets?: string[];
  capabilities?: { actionKey: string; label: string }[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [appearance, setAppearance] = useState<Appearance>(initial.appearance);
  const [behavior, setBehavior] = useState<Behavior>(initial.behavior);
  const [regional, setRegional] = useState<RegionalOverride>(initial.regional);
  const [layout, setLayout] = useState<LayoutPreferences>(() => clampLayout(initial.layout));
  const [profiles, setProfiles] = useState<ProfilesState>(() => clampProfiles(initial.profiles));
  const [wpCat, setWpCat] = useState<Exclude<WallpaperCategory, "user">>("hermes");
  const [wpUploading, setWpUploading] = useState(false);
  const [wpError, setWpError] = useState(false);
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
  // DASH-4H — quick-actions selection (bounded) + favorites toggle (bounded helper).
  const toggleQuickAction = (id: string) => {
    const cur = behavior.quickActions;
    const next = cur.includes(id)
      ? cur.filter((x) => x !== id)
      : cur.length >= MAX_QUICK_ACTIONS
        ? cur
        : [...cur, id];
    setB({ quickActions: next });
  };
  const toggleFav = (ref: string) => setB({ favorites: toggleFavorite(behavior.favorites, ref) });
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

  // --- DASH-4D profiles / modes ---
  const activeProfile = resolveActiveProfile(profiles, layout);
  const commitProfiles = useCallback(
    (next: ProfilesState) => {
      setProfiles(next);
      persistPatch({ profiles: next });
    },
    [persistPatch],
  );
  const profileName = (id: ProfileId): string =>
    profiles.byId[id]?.name?.trim() || t(`profile.${id}` as MessageKey);
  const profileOverride = profiles.byId[activeProfile]?.appearance ?? {};
  const inheritOpt: Opt = { value: "", label: t("profile.settings.inherit") };
  const profileThemeOpts: Opt[] = [inheritOpt, ...A_VALUES.theme.map((v) => ({ value: v, label: themeLabel(v) }))];
  const profileAccentOpts: Opt[] = [inheritOpt, ...A_VALUES.accent.map((v) => ({ value: v, label: t(`opt.accent.${v}` as MessageKey) }))];
  const setProfileTheme = (v: string) =>
    commitProfiles(setProfileAppearance(profiles, activeProfile, { theme: v ? (v as Appearance["theme"]) : undefined }));
  const setProfileAccent = (v: string) =>
    commitProfiles(setProfileAppearance(profiles, activeProfile, { accent: v ? (v as Appearance["accent"]) : undefined }));

  // --- DASH-4E wallpaper (per active profile) ---
  const profWp = profiles.byId[activeProfile];
  const currentWpRef = profWp?.wallpaperRef ?? null;
  const currentWpScrim = profWp?.wallpaperScrim ?? 0.2;
  const currentWpPos = (profWp?.wallpaperPosition as WallpaperPosition) ?? "center";
  const setWp = (fields: Parameters<typeof setProfileWallpaper>[2]) =>
    commitProfiles(setProfileWallpaper(profiles, activeProfile, fields));
  const wpPosOpts: Opt[] = WALLPAPER_POSITIONS.map((p) => ({
    value: p,
    label: t(`wallpaper.pos.${p}` as MessageKey),
  }));
  const currentIsUserWp = isUserWallpaperRef(currentWpRef);
  // A `user:` object is safe to delete only if NO other profile — nor the global
  // default — still references it (refs can be shared across profiles).
  const isOrphanAfterReplace = (ref: string | null): ref is string => {
    if (!ref || !isUserWallpaperRef(ref)) return false;
    if (profiles.wallpaper?.wallpaperRef === ref) return false;
    for (const [id, cfg] of Object.entries(profiles.byId)) {
      if (id !== activeProfile && cfg?.wallpaperRef === ref) return false;
    }
    return true;
  };
  const onUploadWallpaper = async (file: File | null | undefined) => {
    if (!file) return;
    setWpError(false);
    setWpUploading(true);
    try {
      // Compress client-side (max edge 2560, JPEG q0.82) before upload — COST-FIRST.
      const enc = await encodeImageFileToJpeg(file, 2560, 0.82);
      const jpeg = new File([enc.blob], "wallpaper.jpg", { type: "image/jpeg" });
      const fd = new FormData();
      fd.append("file", jpeg);
      const res = await uploadWallpaperAction(fd);
      if (res.ok) {
        const previousRef = currentWpRef;
        setWp({ wallpaperRef: res.ref });
        // ORPHAN_POLICY (V1, no cron/GC): replacing this profile's own photo deletes
        // the previous object when nothing else references it — bounds stored user
        // wallpapers to ≤ profile count. Ownership is re-checked server-side.
        if (isOrphanAfterReplace(previousRef)) {
          void deleteWallpaperAction(previousRef);
        }
        router.refresh(); // re-sign server-side so the dashboard shows the new fond
      } else {
        setWpError(true);
      }
    } catch {
      setWpError(true);
    } finally {
      setWpUploading(false);
    }
  };
  const onDeleteWallpaper = async () => {
    if (!currentIsUserWp || !currentWpRef) return;
    await deleteWallpaperAction(currentWpRef);
    setWp({ wallpaperRef: null });
    router.refresh();
  };

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
        <Section title={t("settings.section.profiles")}>
          <div className="settings-row settings-row-block">
            <span className="settings-row-label">{t("profile.settings.active")}</span>
            <div className="profile-switcher-chips" role="group" aria-label={t("profile.switcher.aria")}>
              {PROFILE_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`profile-chip${id === activeProfile ? " is-active" : ""}`}
                  aria-pressed={id === activeProfile}
                  onClick={() => commitProfiles(setActiveProfile(profiles, id))}
                >
                  {profileName(id)}
                </button>
              ))}
            </div>
          </div>
          <SelectRow
            label={t("profile.settings.theme")}
            value={profileOverride.theme ?? ""}
            options={profileThemeOpts}
            onChange={setProfileTheme}
          />
          <SelectRow
            label={t("profile.settings.accent")}
            value={profileOverride.accent ?? ""}
            options={profileAccentOpts}
            onChange={setProfileAccent}
          />
          {activeProfile === "custom" ? (
            <label className="settings-row">
              <span className="settings-row-label">{t("profile.settings.rename")}</span>
              <input
                className="settings-select"
                type="text"
                maxLength={64}
                defaultValue={profiles.byId.custom?.name ?? ""}
                placeholder={t("profile.custom")}
                onBlur={(e) =>
                  commitProfiles(renameProfile(profiles, "custom", e.target.value.trim() || null))
                }
              />
            </label>
          ) : null}
          <button
            type="button"
            className="settings-reset"
            onClick={() => commitProfiles(resetProfile(profiles, activeProfile))}
          >
            {t("profile.settings.reset")}
          </button>
          <p className="settings-reset-note">{t("profile.settings.resetNote")}</p>
        </Section>

        <Section title={t("settings.section.wallpaper")}>
          <p className="settings-reset-note">
            {t("wallpaper.activeNote", { profile: profileName(activeProfile) })}
          </p>
          <div className="wallpaper-cat-tabs" role="tablist" aria-label={t("settings.section.wallpaper")}>
            {(["hermes", "espace", "montagne", "mer", "tropical"] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={wpCat === c}
                className={`profile-chip${wpCat === c ? " is-active" : ""}`}
                onClick={() => setWpCat(c)}
              >
                {t(`wallpaper.cat.${c}` as MessageKey)}
              </button>
            ))}
          </div>
          <div className="wallpaper-gallery">
            {wallpapersByCategory(wpCat).map((w) => (
              <button
                key={w.id}
                type="button"
                className={`wallpaper-thumb wallpaper-${w.id}${currentWpRef === w.id ? " is-active" : ""}`}
                aria-pressed={currentWpRef === w.id}
                aria-label={t(`wallpaper.name.${w.id}` as MessageKey)}
                title={t(`wallpaper.name.${w.id}` as MessageKey)}
                onClick={() => setWp({ wallpaperRef: w.id })}
              />
            ))}
          </div>
          <SelectRow
            label={t("wallpaper.position")}
            value={currentWpPos}
            options={wpPosOpts}
            onChange={(v) => setWp({ wallpaperPosition: v })}
          />
          <label className="settings-row">
            <span className="settings-row-label">{t("wallpaper.scrim")}</span>
            <input
              className="settings-range"
              type="range"
              min={0}
              max={0.5}
              step={0.02}
              value={currentWpScrim}
              aria-label={t("wallpaper.scrim")}
              onChange={(e) => setWp({ wallpaperScrim: Number(e.target.value) })}
            />
          </label>
          {/* Personal wallpaper — reuses the private storage infra (image-only,
              tenant/user isolated, signed URLs). Compressed client-side before upload. */}
          <label className="settings-wp-upload">
            <span className="settings-reset">{wpUploading ? t("wallpaper.uploading") : t("wallpaper.upload")}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              disabled={wpUploading}
              onChange={(e) => {
                void onUploadWallpaper(e.target.files?.[0]);
                e.currentTarget.value = "";
              }}
            />
          </label>
          {wpError ? <p className="settings-savestate is-error">{t("wallpaper.uploadError")}</p> : null}
          {currentIsUserWp ? (
            <>
              <p className="settings-reset-note">{t("wallpaper.userFond")}</p>
              <button type="button" className="settings-reset" onClick={() => void onDeleteWallpaper()}>
                {t("wallpaper.delete")}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="settings-reset"
            onClick={() => setWp({ wallpaperRef: null, wallpaperScrim: null, wallpaperPosition: null })}
          >
            {t("wallpaper.reset")}
          </button>
        </Section>

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

        {/* DASH-4H — default opening screen (user-scoped, multi-device). */}
        <Section title={t("settings.section.home")}>
          <ToggleRow
            label={t("settings.row.openLastMode")}
            checked={behavior.openLastMode}
            onChange={(v) => setB({ openLastMode: v })}
          />
          <SelectRow
            label={t("settings.row.defaultHome")}
            value={isValidDefaultHome(behavior.defaultHome) ? (behavior.defaultHome as string) : ""}
            options={[
              { value: "", label: t("settings.inherit") },
              ...PROFILE_IDS.map((id) => ({ value: id, label: t(`profile.${id}` as MessageKey) })),
            ]}
            onChange={(v) => setB({ defaultHome: v || null })}
          />
        </Section>

        {/* DASH-4H — customizable Quick Actions (nav shortcuts + granted capabilities). */}
        <Section title={t("settings.section.quickActions")}>
          <div className="settings-chips">
            {NAV_SHORTCUTS.map((n) => (
              <ChipToggle
                key={n.id}
                active={behavior.quickActions.includes(n.id)}
                label={t(n.labelKey as MessageKey)}
                onClick={() => toggleQuickAction(n.id)}
              />
            ))}
            {capabilities.map((c) => (
              <ChipToggle
                key={c.actionKey}
                active={behavior.quickActions.includes(c.actionKey)}
                label={c.label}
                onClick={() => toggleQuickAction(c.actionKey)}
              />
            ))}
          </div>
          <p className="settings-reset-note">{t("settings.quickActions.note")}</p>
        </Section>

        {/* DASH-4H — Favorites (pinned nav shortcuts + widgets). */}
        <Section title={t("settings.section.favorites")}>
          <div className="settings-chips">
            {NAV_SHORTCUTS.map((n) => (
              <ChipToggle
                key={`nav:${n.id}`}
                active={behavior.favorites.includes(favoriteNavRef(n.id))}
                label={t(n.labelKey as MessageKey)}
                onClick={() => toggleFav(favoriteNavRef(n.id))}
              />
            ))}
            {WIDGET_REGISTRY.map((w) => (
              <ChipToggle
                key={`w:${w.id}`}
                active={behavior.favorites.includes(favoriteWidgetRef(w.id))}
                label={t(`widget.${w.id}` as MessageKey)}
                onClick={() => toggleFav(favoriteWidgetRef(w.id))}
              />
            ))}
          </div>
          <p className="settings-reset-note">{t("settings.favorites.note")}</p>
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
