"use client";

import { AlertTriangle, CalendarClock, MapPin, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import {
  formatClock,
  formatTemperature,
  formatWind,
  isValidTimeZone,
  type ContextBarModel,
} from "@/lib/dashboard/contextBar";
import { useI18n } from "@/lib/i18n/I18nProvider";

type Props = {
  model: ContextBarModel;
  /** Server-formatted clock for the tenant timezone — used for the first paint
   *  so hydration matches exactly, then replaced by the live client clock. */
  initialClock: { time: string; date: string; offset: string };
  /** Optional segment allow-list — the seam a future DASH-4 personalization
   *  layer will drive per user/tenant. Unset ⇒ every segment is shown. */
  visibleSegments?: string[];
};

function fmtCurrency(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: amount < 1 ? 4 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(amount < 1 ? 4 : 2)} ${currency}`;
  }
}

export default function ContextBar({ model, initialClock, visibleSegments }: Props) {
  const { t } = useI18n();
  const { settings, timezone, timezoneSource, units, weather, cost, alerts } =
    model;
  const locale = settings.locale || "fr-FR";
  const hour12 = units.hourCycle === "12h";
  // DASH-4B: per-segment visibility (unset ⇒ every segment shown). Toggling a
  // segment only changes rendering — never adds a fetch (data already loaded, and
  // weather is skipped upstream when its segment is off).
  const show = (seg: string) => !visibleSegments || visibleSegments.includes(seg);
  const showLocation = show("location");
  const showDate = show("date");
  const showTime = show("time");
  const showClock = showDate || showTime;
  const showWeather = show("weather");
  const showTemperature = show("temperature");
  const showRain = show("rain");
  const showWind = show("wind");
  // The weather block renders if ANY weather-dependent segment is on (temperature
  // is a peer of the weather condition, not a child) — must match the upstream
  // fetch condition so the data is available whenever any part is shown.
  const showWeatherSeg = showWeather || showTemperature || showRain || showWind;
  const showNextEvent = show("nextEvent");
  const showAlerts = show("alerts");
  const showCost = show("cost");
  const showSeconds = model.showSeconds;

  // Live clock island — the only timer on the dashboard. Null until mounted so
  // the first client render reuses the server strings (hydration-safe), then we
  // tick every second. When the tenant has no timezone configured (fallback to
  // UTC), opportunistically upgrade to the browser zone — zero cost, no consent.
  const [liveClock, setLiveClock] = useState<{
    time: string;
    date: string;
    offset: string;
  } | null>(null);

  useEffect(() => {
    let tz = timezone;
    if (timezoneSource === "fallback") {
      try {
        const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (isValidTimeZone(browserTz)) tz = browserTz;
      } catch {
        /* keep the resolved (UTC) fallback */
      }
    }
    const tick = () =>
      setLiveClock(formatClock(new Date(), tz, locale, { hour12, showSeconds }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timezone, timezoneSource, locale, hour12, showSeconds]);

  const clock = liveClock ?? initialClock;

  return (
    <div className="context-bar" role="status" aria-live="off">
      {/* Localisation */}
      {showLocation ? (
        <span className="context-seg context-seg-location">
          <MapPin className="context-ico" aria-hidden />
          {settings.city ? (
            <span className="context-strong">{settings.city}</span>
          ) : (
            <span className="context-muted">{t("context.location.todo")}</span>
          )}
        </span>
      ) : null}

      {showLocation && showClock ? (
        <span className="context-sep" aria-hidden>
          ·
        </span>
      ) : null}

      {/* Date · heure locale (live) */}
      {showClock ? (
        <span className="context-seg context-seg-clock">
          {showDate ? <span className="context-date">{clock.date}</span> : null}
          {showTime ? (
            <span className="context-time" suppressHydrationWarning>
              {clock.time}
            </span>
          ) : null}
          {showTime ? (
            <span className="context-tz" title={timezone}>
              {clock.offset}
            </span>
          ) : null}
        </span>
      ) : null}

      {(showLocation || showClock) && showWeatherSeg ? (
        <span className="context-sep" aria-hidden>
          ·
        </span>
      ) : null}

      {/* Météo — chaque sous-segment (condition, température, pluie, vent) est
          gaté indépendamment ; le conteneur s'affiche si l'un d'eux est visible. */}
      {showWeatherSeg ? (
      <span className="context-seg context-seg-weather">
        {weather.provenance === "REAL" ? (
          <>
            {showWeather ? (
              <span className="context-wx-icon" aria-hidden>
                {weather.snapshot.icon}
              </span>
            ) : null}
            {showTemperature ? (
              <span className="context-strong">
                {formatTemperature(
                  weather.snapshot.temperatureC,
                  units.temperature,
                )}
              </span>
            ) : null}
            {showWeather ? (
              <span className="context-muted context-hide-mobile">
                {weather.snapshot.condition}
              </span>
            ) : null}
            {showRain &&
            weather.snapshot.precipitationMm !== null &&
            weather.snapshot.precipitationMm > 0 ? (
              <span className="context-muted context-hide-tablet">
                · {weather.snapshot.precipitationMm} mm
              </span>
            ) : null}
            {showWind && weather.snapshot.windKph !== null ? (
              <span className="context-muted context-hide-tablet">
                · {formatWind(weather.snapshot.windKph, units.wind)}
              </span>
            ) : null}
          </>
        ) : showWeather ? (
          <span className="context-muted">
            {settings.locationConfigured
              ? t("context.weather.unavailable")
              : t("context.weather.todo")}
          </span>
        ) : null}
      </span>
      ) : null}

      <span className="context-spacer" aria-hidden />

      {/* Prochain RDV — emplacement préparé ; source agenda = DASH-2. */}
      {showNextEvent && model.nextEvent.provenance === "REAL" ? (
        <span className="context-seg context-seg-agenda context-hide-mobile">
          <CalendarClock className="context-ico" aria-hidden />
          <span className="context-strong">{model.nextEvent.label}</span>
          {model.nextEvent.whenLabel ? (
            <span className="context-muted">{model.nextEvent.whenLabel}</span>
          ) : null}
        </span>
      ) : null}

      {/* Alertes importantes */}
      {showAlerts ? (
      <span className="context-seg context-seg-alerts">
        <AlertTriangle className="context-ico" aria-hidden />
        {alerts.provenance === "REAL" ? (
          <span
            className={alerts.count > 0 ? "context-strong" : "context-muted"}
          >
            {t(alerts.count === 1 ? "context.alerts.one" : "context.alerts.other", { count: alerts.count })}
          </span>
        ) : (
          <span className="context-muted">—</span>
        )}
      </span>
      ) : null}

      {/* Coût Hermès (devise source réelle — SW23/USD). Aujourd'hui = principal ;
          mois + budget restant = secondaires (masqués sur petits écrans). */}
      {showCost ? (
      <span className="context-seg context-seg-cost">
        <Sparkles className="context-ico" aria-hidden />
        <span className="context-muted">{t("context.brand")}</span>
        {cost.provenance === "REAL" ? (
          <>
            <span
              className="context-strong"
              title={t("context.cost.todayTitle")}
            >
              {fmtCurrency(cost.todayAmount, cost.currency, locale)}
            </span>
            <span className="context-muted context-hide-mobile">{t("context.cost.today")}</span>
            {cost.monthAmount !== null ? (
              <span
                className="context-muted context-hide-tablet"
                title={t("context.cost.monthTitle")}
              >
                · {fmtCurrency(cost.monthAmount, cost.currency, locale)} {t("context.cost.month")}
              </span>
            ) : null}
            {cost.remainingAmount !== null ? (
              <span
                className="context-muted context-hide-tablet"
                title={t("context.cost.remainingTitle")}
              >
                · {fmtCurrency(cost.remainingAmount, cost.currency, locale)}{" "}
                {t("context.cost.remaining")}
              </span>
            ) : null}
          </>
        ) : (
          <span className="context-muted" title={t("context.cost.unavailable")}>
            {t("context.cost.unavailable")}
          </span>
        )}
      </span>
      ) : null}
    </div>
  );
}
