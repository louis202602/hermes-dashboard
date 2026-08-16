"use client";

import {
  Activity,
  Bell,
  Blocks,
  Bot,
  Building2,
  ClipboardCheck,
  CreditCard,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Shield,
  Sparkles,
} from "lucide-react";

import { signOutAction } from "@/app/login/actions";
import { HermesLogoSymbol } from "@/components/common/HermesLogo";
import type { MessageKey } from "@/lib/i18n/locales/fr";
import { useI18n } from "@/lib/i18n/I18nProvider";

type SidebarProps = {
  userEmail?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
};

// The official Hermès OS navigation. Only "Command Center" (the current Accueil)
// is built; the other destinations are shown per the master mockup but are
// disabled with a "Bientôt disponible" hint — never a fake, working button.
// Labels are i18n keys (localized at render); routes/icons are stable.
const NAV: { key: MessageKey; icon: typeof LayoutDashboard; active?: boolean }[] = [
  { key: "nav.commandCenter", icon: LayoutDashboard, active: true },
  { key: "nav.chat", icon: Sparkles },
  { key: "nav.activity", icon: Activity },
  { key: "nav.company", icon: Building2 },
  { key: "nav.agents", icon: Bot },
  { key: "nav.approvals", icon: ClipboardCheck },
  { key: "nav.security", icon: Shield },
  { key: "nav.integrations", icon: Blocks },
  { key: "header.notifications", icon: Bell },
  { key: "nav.billing", icon: CreditCard },
  { key: "nav.settings", icon: Settings },
];

function initials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[.\-_]/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return (letters || local.slice(0, 2) || "?").toUpperCase();
}

function displayName(email: string): string {
  const local = email.split("@")[0] ?? "";
  const token = local.split(/[.\-_]/).filter(Boolean)[0] ?? local;
  const clean = token.replace(/\d+/g, "");
  if (!clean) return "";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export default function Sidebar({
  userEmail,
  collapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  const { t } = useI18n();
  const email = userEmail ?? "";
  const name = displayName(email) || t("sidebar.userFallback");

  return (
    <aside className={`hos-sidebar${collapsed ? " is-collapsed" : ""}`}>
      <div className="hos-brand">
        <span className="hos-brand-mark">
          <HermesLogoSymbol size={26} />
        </span>
        <span className="hos-brand-copy">
          <strong>
            HERMÈS <span className="hos-accent">OS</span>
          </strong>
          <span>{t("sidebar.role")}</span>
        </span>
      </div>

      <nav className="hos-nav" aria-label={t("sidebar.navAria")}>
        {NAV.map((item) => {
          const Icon = item.icon;
          const soon = !item.active;
          return (
            <button
              type="button"
              key={item.key}
              className={`hos-nav-item${item.active ? " is-active" : ""}${
                soon ? " is-soon" : ""
              }`}
              disabled={soon}
              aria-disabled={soon || undefined}
              aria-current={item.active ? "page" : undefined}
              title={soon ? t("header.notifications.soon") : undefined}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span className="hos-nav-label">{t(item.key)}</span>
            </button>
          );
        })}
      </nav>

      <div className="hos-sidebar-foot">
        <button
          type="button"
          className="hos-nav-item is-soon"
          disabled
          title={t("header.notifications.soon")}
        >
          <HelpCircle size={19} strokeWidth={1.8} />
          <span className="hos-nav-label">{t("sidebar.help")}</span>
        </button>

        <div className="hos-profile" title={email || undefined}>
          <span className="hos-avatar">{initials(email)}</span>
          <span className="hos-profile-copy">
            <strong>{name}</strong>
            <span>{email || t("sidebar.account")}</span>
          </span>
        </div>

        <div className="hos-foot-actions">
          <form action={signOutAction} className="hos-foot-form">
            <button type="submit" className="hos-foot-btn">
              <LogOut size={16} strokeWidth={1.8} />
              <span className="hos-nav-label">{t("sidebar.logout")}</span>
            </button>
          </form>
          <button
            type="button"
            className="hos-foot-btn hos-collapse-btn"
            onClick={onToggleCollapse}
            aria-label={collapsed ? t("sidebar.expandNav") : t("sidebar.collapseNav")}
          >
            {collapsed ? (
              <PanelLeftOpen size={16} strokeWidth={1.8} />
            ) : (
              <PanelLeftClose size={16} strokeWidth={1.8} />
            )}
            <span className="hos-nav-label">
              {collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}
