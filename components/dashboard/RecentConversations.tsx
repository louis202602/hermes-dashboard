"use client";

import {
  Bot,
  ChevronRight,
  MessageSquareText,
  MoreHorizontal,
  UserRound,
} from "lucide-react";

const conversations = [
  {
    title: "Qualification des prospects Marseille",
    preview: "Hermès a classé 14 nouveaux prospects selon leur potentiel.",
    time: "Il y a 8 min",
    type: "agent",
  },
  {
    title: "Analyse chantier Toulouse 126 kWc",
    preview: "Le dossier technique a été contrôlé et les points d’attention sont prêts.",
    time: "Il y a 32 min",
    type: "project",
  },
  {
    title: "Préparation relances commerciales",
    preview: "6 messages personnalisés sont disponibles pour validation.",
    time: "Il y a 1 h",
    type: "agent",
  },
  {
    title: "Optimisation des coûts IA",
    preview: "Une économie potentielle de 18 % a été identifiée sur les appels modèles.",
    time: "Hier",
    type: "system",
  },
];

export default function RecentConversations() {
  return (
    <section className="dashboard-card conversations-card">
      <div className="dashboard-card-header">
        <div>
          <span className="panel-eyebrow">HISTORIQUE</span>
          <h3>Conversations récentes</h3>
        </div>

        <button
          type="button"
          className="card-icon-button"
          aria-label="Options des conversations"
        >
          <MoreHorizontal size={19} strokeWidth={1.8} />
        </button>
      </div>

      <div className="conversation-list">
        {conversations.map((conversation) => (
          <button
            type="button"
            className="conversation-item"
            key={conversation.title}
          >
            <span className={`conversation-avatar is-${conversation.type}`}>
              {conversation.type === "agent" ? (
                <Bot size={18} strokeWidth={1.8} />
              ) : conversation.type === "project" ? (
                <UserRound size={18} strokeWidth={1.8} />
              ) : (
                <MessageSquareText size={18} strokeWidth={1.8} />
              )}
            </span>

            <span className="conversation-copy">
              <strong>{conversation.title}</strong>
              <span>{conversation.preview}</span>
            </span>

            <span className="conversation-time">{conversation.time}</span>

            <ChevronRight size={16} strokeWidth={1.8} />
          </button>
        ))}
      </div>

      <button type="button" className="conversations-footer-button">
        <MessageSquareText size={17} strokeWidth={1.8} />
        <span>Ouvrir toutes les conversations</span>
      </button>
    </section>
  );
}
