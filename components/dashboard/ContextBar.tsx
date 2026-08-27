"use client";

import { AlertTriangle, CalendarClock, MapPin, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getContextWeatherAction } from "@/app/actions/context-bar";
import {
  formatClock,
  formatTemperature,
  formatWind,
  isValidTimeZone,
  type ContextBarModel,
  type WeatherSnapshot,
} from "@/lib/dashboard/contextBar";
import { useI18n } from "@/lib/i18n/I18nProvider";

type Props = {
  model: ContextBarModel;
  initialClock: { time: string; date: string; offset: string };
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
  const { settings, timezone, timezoneSource, units, weather, cost, alerts } = model;
  const locale = settings.locale || "fr-FR";
  const hour12 = units.hourCycle === "12h";
  const show = (seg: string) => !visibleSegments || visibleSegments.includes(seg);
  const showLocation = show("location");
  const showDate = show("date");
  const showTime = show("time");
  const showClock = showDate || showTime;
  const showWeather = show("weather");
  const showTemperature = show("temperature");
  const showRain = show("rain");
  const showWind = show("wind");
  const showWeatherSeg = showWeather || showTemperature || showRain || showWind;
  const showNextEvent = show("nextEvent");
  const showAlerts = show("alerts");
  const showCost = show("cost");
  const showSeconds = model.showSeconds;

  const [liveWeather, setLiveWeather] = useState<WeatherSnapshot | null>(null);
  const [gpsActive, setGpsActive] = useState(false);
  const weatherReq = useRef<string | null>(null);

  // For the PV cockpit, prefer the device's actual position. The browser owns the
  // permission prompt: if the user refuses or GPS is unavailable we fall back to the
  // configured tenant coordinates. No IP-derived or invented position is used.
  useEffect(() => {
    if (!showWeatherSeg || typeof navigator === "undefined" || !navigator.geolocation) return;
    let alive = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!alive) return;
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        const key = `gps:${latitude.toFixed(4)},${longitude.toFixed(4)}`;
        if (weatherReq.current === key) return;
        weatherReq.current = key;
        void getContextWeatherAction(latitude, longitude, "auto").then((snap) => {
          if (alive && snap) {
            setLiveWeather(snap);
            setGpsActive(true);
          }
        });
      },
      () => {
        // Permission denied/unavailable: the configured location fallback below remains valid.
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 15 * 60 * 1000 },
    );
    return () => {
      alive = false;
    };
  }, [showWeatherSeg]);

  // Fallback to explicitly configured tenant coordinates when GPS has not produced a
  // result. This is still real weather; it simply represents the configured business location.
  useEffect(() => {
    if (!showWeatherSeg || liveWeather) return;
    const { latitude, longitude } = settings;
    if (latitude === null || longitude === null) return;
    const key = `configured:${latitude},${longitude}`;
    if (weatherReq.current === key || weatherReq.current?.startsWith("gps:")) return;
    weatherReq.current = key;
    let alive = true;
    void getContextWeatherAction(latitude, longitude, timezone).then((snap) => {
      if (alive && snap) setLiveWeather(snap);
    });
    return () => {
      alive = false;
    };
  }, [showWeatherSeg, liveWeather, settings, timezone]);

  const displayWeather = liveWeather
    ? ({ provenance: "REAL", snapshot: liveWeather } as const)
    : weather;

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
        /* keep fallback */
      }
    }
    const tick = () => setLiveClock(formatClock(new Date(), tz, locale, { hour12, showSeconds }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timezone, timezoneSource, locale, hour12, showSeconds]);

  const clock = liveClock ?? initialClock;

  return (
    <div className="context-bar" role="status" aria-live="off">
      {showLocation ? (
        <span className="context-seg context-seg-location">
          <MapPin className="context-ico" aria-hidden />
          {gpsActive ? (
            <span className="context-strong">Position GPS</span>
          ) : settings.city ? (
            <span className="context-strong">{settings.city}</span>
          ) : (
            <span className="context-muted">{t("context.location.todo")}</span>
          )}
        </span>
      ) : null}

      {showLocation && showClock ? <span className="context-sep" aria-hidden>·</span> : null}

      {showClock ? (
        <span className="context-seg context-seg-clock">
          {showDate ? <span className="context-date">{clock.date}</span> : null}
          {showTime ? <span className="context-time" suppressHydrationWarning>{clock.time}</span> : null}
          {showTime ? <span className="context-tz" title={timezone}>{clock.offset}</span> : null}
        </span>
      ) : null}

      {(showLocation || showClock) && showWeatherSeg ? <span className="context-sep" aria-hidden>·</span> : null}

      {showWeatherSeg ? (
        <span className="context-seg context-seg-weather">
          {displayWeather.provenance === "REAL" ? (
            <>
              {showWeather ? <span className="context-wx-icon" aria-hidden>{displayWeather.snapshot.icon}</span> : null}
              {showTemperature ? <span className="context-strong">{formatTemperature(displayWeather.snapshot.temperatureC, units.temperature)}</span> : null}
              {showWeather ? <span className="context-muted context-hide-mobile">{displayWeather.snapshot.condition}</span> : null}
              {showRain && displayWeather.snapshot.precipitationMm !== null && displayWeather.snapshot.precipitationMm > 0 ? <span className="context-muted context-hide-tablet">· {displayWeather.snapshot.precipitationMm} mm</span> : null}
              {showWind && displayWeather.snapshot.windKph !== null ? <span className="context-muted context-hide-tablet">· {formatWind(displayWeather.snapshot.windKph, units.wind)}</span> : null}
            </>
          ) : showWeather ? <span className="context-muted">{settings.locationConfigured ? t("context.weather.unavailable") : t("context.weather.todo")}</span> : null}
        </span>
      ) : null}

      <span className="context-spacer" aria-hidden />

      {showNextEvent && model.nextEvent.provenance === "REAL" ? (
        <span className="context-seg context-seg-agenda context-hide-mobile">
          <CalendarClock className="context-ico" aria-hidden />
          <span className="context-strong">{model.nextEvent.label}</span>
          {model.nextEvent.whenLabel ? <span className="context-muted">{model.nextEvent.whenLabel}</span> : null}
        </span>
      ) : null}

      {showAlerts ? (
        <span className="context-seg context-seg-alerts">
          <AlertTriangle className="context-ico" aria-hidden />
          {alerts.provenance === "REAL" ? <span className={alerts.count > 0 ? "context-strong" : "context-muted"}>{t(alerts.count === 1 ? "context.alerts.one" : "context.alerts.other", { count: alerts.count })}</span> : <span className="context-muted">—</span>}
        </span>
      ) : null}

      {showCost ? (
        <span className="context-seg context-seg-cost">
          <Sparkles className="context-ico" aria-hidden />
          <span className="context-muted">{t("context.brand")}</span>
          {cost.provenance === "REAL" ? (
            <>
              <span className="context-strong" title={t("context.cost.todayTitle")}>{fmtCurrency(cost.todayAmount, cost.currency, locale)}</span>
              <span className="context-muted context-hide-mobile">{t("context.cost.today")}</span>
              {cost.monthAmount !== null ? <span className="context-muted context-hide-tablet" title={t("context.cost.monthTitle")}>· {fmtCurrency(cost.monthAmount, cost.currency, locale)} {t("context.cost.month")}</span> : null}
              {cost.remainingAmount !== null ? <span className="context-muted context-hide-tablet" title={t("context.cost.remainingTitle")}>· {fmtCurrency(cost.remainingAmount, cost.currency, locale)} {t("context.cost.remaining")}</span> : null}
            </>
          ) : <span className="context-muted" title={t("context.cost.unavailable")}>{t("context.cost.unavailable")}</span>}
        </span>
      ) : null}
    </div>
  );
}
