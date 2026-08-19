"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  Blocks,
  Bot,
  Building2,
  Camera,
  ClipboardCheck,
  CreditCard,
  FileSignature,
  FolderOpen,
  Gift,
  HardHat,
  HelpCircle,
  Home,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  Megaphone,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  Settings,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  UserSquare,
  Users,
  Wallet,
} from "lucide-react";

import { signOutAction } from "@/app/login/actions";
import { HermesLogoSymbol } from "@/components/common/HermesLogo";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { ModuleId } from "@/lib/verticals/modules";
import type { NavEntry } from "@/lib/verticals/navigation";

type SidebarProps = {
  userEmail?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Close the mobile drawer after a client-side navigation. */
  onNavigate?: () => void;
  /**
   * LE MENU, calculé côté serveur par le moteur de verticales. La sidebar ne
   * décide plus de rien : elle rend. C'est ce qui garantit que le menu et la
   * garde de route ne peuvent pas diverger — ils lisent la même liste.
   */
  navigation: NavEntry[];
};

/**
 * Icône par module. C'est la SEULE chose que la sidebar sait encore d'elle-même,
 * et c'est purement décoratif : un module inconnu retombe sur une icône neutre
 * plutôt que de disparaître. Aucune décision d'accès ne se prend ici.
 */
const MODULE_ICON: Record<string, typeof LayoutDashboard> = {
  "core.home": LayoutDashboard,
  "core.chat": Sparkles,
  "core.activity": Activity,
  "core.company": Building2,
  "core.agents": Bot,
  "core.approvals": ClipboardCheck,
  "core.security": Shield,
  "core.integrations": Blocks,
  "core.notifications": Bell,
  "core.billing": CreditCard,
  "core.settings": Settings,
  "core.help": HelpCircle,
  "crm.prospects": Target,
  "crm.clients": Users,
  agenda: Home,
  phone: Phone,
  campaigns: Megaphone,
  documents: FolderOpen,
  "photo.sessions": Camera,
  "photo.gallery": ImageIcon,
  "photo.quotes": FileSignature,
  "photo.payments": Wallet,
  "photo.portal": UserSquare,
  "photo.upsell": TrendingUp,
  "photo.lifecycle": Gift,
  "immo.properties": Building2,
  "immo.sellers": Users,
  "immo.buyers": Users,
  "immo.viewings": Home,
  "solar.studies": Activity,
  worksites: HardHat,
};

function iconFor(moduleId: ModuleId): typeof LayoutDashboard {
  return MODULE_ICON[moduleId] ?? LayoutDashboard;
}

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
  navigation,
}: SidebarProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  // Le module « aide » est rendu à part, en pied de barre : il n'a rien à faire
  // au milieu des entrées métier.
  const navItems = navigation.filter((item) => item.moduleId !== "core.help");
  const helpItem = navigation.find((item) => item.moduleId === "core.help");
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
        {navItems.map((item) => {
          const Icon = iconFor(item.moduleId);
          // Page construite → vrai lien ; sinon bouton désactivé « bientôt ».
          if (item.href && !item.comingSoon) {
            const active = isActive(item.href);
            return (
              <Link
                key={item.moduleId}
                href={item.href}
                className={`hos-nav-item${active ? " is-active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
              >
                <Icon size={19} strokeWidth={1.8} />
                <span className="hos-nav-label">{t(item.labelKey)}</span>
              </Link>
            );
          }
          return (
            <button
              type="button"
              key={item.moduleId}
              className="hos-nav-item is-soon"
              disabled
              aria-disabled
              title={t("header.notifications.soon")}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span className="hos-nav-label">{t(item.labelKey)}</span>
            </button>
          );
        })}
      </nav>

      <div className="hos-sidebar-foot">
        {helpItem?.href ? (
          <Link
            href={helpItem.href}
            className={`hos-nav-item${isActive(helpItem.href) ? " is-active" : ""}`}
            aria-current={isActive(helpItem.href) ? "page" : undefined}
            onClick={onNavigate}
          >
            <HelpCircle size={19} strokeWidth={1.8} />
            <span className="hos-nav-label">{t(helpItem.labelKey)}</span>
          </Link>
        ) : null}

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
