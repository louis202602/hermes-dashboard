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

export default function ContextBar({ model, initialClock }: Props) {
  const { settings, timezone, timezoneSource, units, weather, cost, alerts } =
    model;
  const locale = settings.locale || "fr-FR";
  const hour12 = units.hourCycle === "12h";

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
      setLiveClock(formatClock(new Date(), tz, locale, { hour12 }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timezone, timezoneSource, locale, hour12]);

  const clock = liveClock ?? initialClock;

  return (
    <div className="context-bar" role="status" aria-live="off">
      {/* Localisation */}
      <span className="context-seg context-seg-location">
        <MapPin className="context-ico" aria-hidden />
        {settings.city ? (
          <span className="context-strong">{settings.city}</span>
        ) : (
          <span className="context-muted">Localisation à configurer</span>
        )}
      </span>

      <span className="context-sep" aria-hidden>
        ·
      </span>

      {/* Date · heure locale (live) */}
      <span className="context-seg context-seg-clock">
        <span className="context-date">{clock.date}</span>
        <span className="context-time" suppressHydrationWarning>
          {clock.time}
        </span>
        <span className="context-tz" title={timezone}>
          {clock.offset}
        </span>
      </span>

      <span className="context-sep" aria-hidden>
        ·
      </span>

      {/* Météo */}
      <span className="context-seg context-seg-weather">
        {weather.provenance === "REAL" ? (
          <>
            <span className="context-wx-icon" aria-hidden>
              {weather.snapshot.icon}
            </span>
            <span className="context-strong">
              {formatTemperature(
                weather.snapshot.temperatureC,
                units.temperature,
              )}
            </span>
            <span className="context-muted context-hide-mobile">
              {weather.snapshot.condition}
            </span>
            {weather.snapshot.precipitationMm !== null &&
            weather.snapshot.precipitationMm > 0 ? (
              <span className="context-muted context-hide-tablet">
                · {weather.snapshot.precipitationMm} mm
              </span>
            ) : null}
            {weather.snapshot.windKph !== null ? (
              <span className="context-muted context-hide-tablet">
                · {formatWind(weather.snapshot.windKph, units.wind)}
              </span>
            ) : null}
          </>
        ) : (
          <span className="context-muted">
            {settings.locationConfigured
              ? "Météo indisponible"
              : "Météo à configurer"}
          </span>
        )}
      </span>

      <span className="context-spacer" aria-hidden />

      {/* Prochain RDV — emplacement préparé ; source agenda = DASH-2. */}
      {model.nextEvent.provenance === "REAL" ? (
        <span className="context-seg context-seg-agenda context-hide-mobile">
          <CalendarClock className="context-ico" aria-hidden />
          <span className="context-strong">{model.nextEvent.label}</span>
          {model.nextEvent.whenLabel ? (
            <span className="context-muted">{model.nextEvent.whenLabel}</span>
          ) : null}
        </span>
      ) : null}

      {/* Alertes importantes */}
      <span className="context-seg context-seg-alerts">
        <AlertTriangle className="context-ico" aria-hidden />
        {alerts.provenance === "REAL" ? (
          <span
            className={alerts.count > 0 ? "context-strong" : "context-muted"}
          >
            {alerts.count} {alerts.count > 1 ? "alertes" : "alerte"}
          </span>
        ) : (
          <span className="context-muted">—</span>
        )}
      </span>

      {/* Coût Hermès (devise source réelle — SW23/USD). Aujourd'hui = principal ;
          mois + budget restant = secondaires (masqués sur petits écrans). */}
      <span className="context-seg context-seg-cost">
        <Sparkles className="context-ico" aria-hidden />
        <span className="context-muted">Hermès</span>
        {cost.provenance === "REAL" ? (
          <>
            <span
              className="context-strong"
              title="Coût IA aujourd'hui (source SW23)"
            >
              {fmtCurrency(cost.todayAmount, cost.currency, locale)}
            </span>
            <span className="context-muted context-hide-mobile">aujourd’hui</span>
            {cost.monthAmount !== null ? (
              <span
                className="context-muted context-hide-tablet"
                title="Coût IA ce mois-ci (source SW23)"
              >
                · {fmtCurrency(cost.monthAmount, cost.currency, locale)} ce mois
              </span>
            ) : null}
            {cost.remainingAmount !== null ? (
              <span
                className="context-muted context-hide-tablet"
                title="Budget mensuel restant"
              >
                · {fmtCurrency(cost.remainingAmount, cost.currency, locale)}{" "}
                restant
              </span>
            ) : null}
          </>
        ) : (
          <span className="context-muted" title="Coût non disponible">
            indisponible
          </span>
        )}
      </span>
    </div>
  );
}
