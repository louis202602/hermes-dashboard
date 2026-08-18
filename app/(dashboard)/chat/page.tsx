import HermesPanel from "@/components/dashboard/HermesPanel";
import PageHeading from "@/components/dashboard/PageHeading";
import RecentConversations from "@/components/dashboard/RecentConversations";
import { getRecentConversations } from "@/services/hermes/conversations";

export const metadata = { title: "Hermès Chat — Hermès OS" };

/**
 * /chat — Hermès en version complète + l'activité récente des conversations. Réutilise
 * HermesPanel (canal sécurisé orchestrateur→gateway, inchangé) et RecentConversations.
 * Aucun nouveau système de chat. Le chrome (sidebar/header/wallpaper) vient du layout.
 */
export default async function ChatPage() {
  const conversations = await getRecentConversations();
  return (
    <div className="page-stack">
      <PageHeading titleKey="nav.chat" />
      <div id="hermes-command">
        <HermesPanel />
      </div>
      <RecentConversations conversations={conversations} />
    </div>
  );
}
