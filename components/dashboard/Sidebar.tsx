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

type SidebarProps = {
  userEmail?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
};

// The official Hermès OS navigation. Only "Command Center" (the current Accueil)
// is built; the other destinations are shown per the master mockup but are
// disabled with a "Bientôt disponible" hint — never a fake, working button.
const NAV = [
  { label: "Command Center", icon: LayoutDashboard, active: true },
  { label: "Hermès Chat", icon: Sparkles },
  { label: "Activité", icon: Activity },
  { label: "Entreprise", icon: Building2 },
  { label: "Agents", icon: Bot },
  { label: "Approbations", icon: ClipboardCheck },
  { label: "Sécurité & Autonomie", icon: Shield },
  { label: "Intégrations", icon: Blocks },
  { label: "Notifications", icon: Bell },
  { label: "Facturation & Coûts IA", icon: CreditCard },
  { label: "Paramètres", icon: Settings },
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
  if (!clean) return "Utilisateur";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export default function Sidebar({
  userEmail,
  collapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  const email = userEmail ?? "";

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
          <span>Directeur Général IA</span>
        </span>
      </div>

      <nav className="hos-nav" aria-label="Navigation Hermès OS">
        {NAV.map((item) => {
          const Icon = item.icon;
          const soon = !item.active;
          return (
            <button
              type="button"
              key={item.label}
              className={`hos-nav-item${item.active ? " is-active" : ""}${
                soon ? " is-soon" : ""
              }`}
              disabled={soon}
              aria-disabled={soon || undefined}
              aria-current={item.active ? "page" : undefined}
              title={soon ? "Bientôt disponible" : undefined}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span className="hos-nav-label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="hos-sidebar-foot">
        <button
          type="button"
          className="hos-nav-item is-soon"
          disabled
          title="Bientôt disponible"
        >
          <HelpCircle size={19} strokeWidth={1.8} />
          <span className="hos-nav-label">Aide &amp; Support</span>
        </button>

        <div className="hos-profile" title={email || undefined}>
          <span className="hos-avatar">{initials(email)}</span>
          <span className="hos-profile-copy">
            <strong>{displayName(email)}</strong>
            <span>{email || "Compte Hermès OS"}</span>
          </span>
        </div>

        <div className="hos-foot-actions">
          <form action={signOutAction} className="hos-foot-form">
            <button type="submit" className="hos-foot-btn">
              <LogOut size={16} strokeWidth={1.8} />
              <span className="hos-nav-label">Déconnexion</span>
            </button>
          </form>
          <button
            type="button"
            className="hos-foot-btn hos-collapse-btn"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Étendre la navigation" : "Réduire la navigation"}
          >
            {collapsed ? (
              <PanelLeftOpen size={16} strokeWidth={1.8} />
            ) : (
              <PanelLeftClose size={16} strokeWidth={1.8} />
            )}
            <span className="hos-nav-label">{collapsed ? "Étendre" : "Réduire"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
