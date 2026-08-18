"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  /** Close the mobile drawer after a client-side navigation. */
  onNavigate?: () => void;
};

// The official Hermès OS navigation. Items with a built route (`href`) are real
// Next.js links; destinations whose page does not exist yet carry NO href and stay
// disabled with a "Bientôt disponible" hint — never a fake, dead link. Labels are
// i18n keys (localized at render); routes/icons are stable.
const NAV: { key: MessageKey; icon: typeof LayoutDashboard; href?: string }[] = [
  { key: "nav.commandCenter", icon: LayoutDashboard, href: "/" },
  { key: "nav.chat", icon: Sparkles, href: "/chat" },
  { key: "nav.activity", icon: Activity, href: "/activite" },
  { key: "nav.company", icon: Building2, href: "/entreprise" },
  { key: "nav.agents", icon: Bot, href: "/agents" },
  { key: "nav.approvals", icon: ClipboardCheck, href: "/approbations" },
  { key: "nav.security", icon: Shield, href: "/securite" },
  { key: "nav.integrations", icon: Blocks, href: "/integrations" },
  { key: "header.notifications", icon: Bell, href: "/notifications" },
  { key: "nav.billing", icon: CreditCard, href: "/facturation" },
  { key: "nav.settings", icon: Settings, href: "/parametres/dashboard" },
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
  onNavigate,
}: SidebarProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const email = userEmail ?? "";
  const name = displayName(email) || t("sidebar.userFallback");
  const isActive = (href: string): boolean =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

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
          // Route exists → a real navigable link; otherwise a disabled "coming soon" button.
          if (item.href) {
            const active = isActive(item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`hos-nav-item${active ? " is-active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
              >
                <Icon size={19} strokeWidth={1.8} />
                <span className="hos-nav-label">{t(item.key)}</span>
              </Link>
            );
          }
          return (
            <button
              type="button"
              key={item.key}
              className="hos-nav-item is-soon"
              disabled
              aria-disabled
              title={t("header.notifications.soon")}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span className="hos-nav-label">{t(item.key)}</span>
            </button>
          );
        })}
      </nav>

      <div className="hos-sidebar-foot">
        <Link
          href="/aide"
          className={`hos-nav-item${isActive("/aide") ? " is-active" : ""}`}
          aria-current={isActive("/aide") ? "page" : undefined}
          onClick={onNavigate}
        >
          <HelpCircle size={19} strokeWidth={1.8} />
          <span className="hos-nav-label">{t("sidebar.help")}</span>
        </Link>

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
