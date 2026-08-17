"use client";

import type { MessageKey } from "@/lib/i18n/locales/fr";
import { useI18n } from "@/lib/i18n/I18nProvider";

type Props = {
  /** i18n key for the page title (reuses the sidebar nav labels). */
  titleKey: MessageKey;
  /** Optional i18n key for a one-line description under the title. */
  descriptionKey?: MessageKey;
};

/**
 * Shared page heading for the dashboard métier sub-pages — a slim eyebrow + localized
 * title (from the same nav i18n keys as the sidebar), so every sub-page announces itself
 * consistently under the shared chrome. Presentational only.
 */
export default function PageHeading({ titleKey, descriptionKey }: Props) {
  const { t } = useI18n();
  return (
    <section className="dashboard-intro dashboard-intro-compact page-heading">
      <div className="dashboard-intro-lead">
        <div>
          <span className="panel-eyebrow">HERMÈS OS</span>
          <h2>{t(titleKey)}</h2>
          {descriptionKey ? (
            <p className="page-heading-desc">{t(descriptionKey)}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
