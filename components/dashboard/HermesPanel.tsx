"use client";

import dynamic from "next/dynamic";
import {
  ArrowUp,
  BrainCircuit,
  CheckCircle2,
  Mic,
  Paperclip,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";

const HermesHologram = dynamic(
  () => import("@/components/hermes/HermesHologram"),
  {
    ssr: false,
    loading: () => (
      <div className="hermes-hologram-loading">
        <Sparkles size={28} strokeWidth={1.7} />
        <span>Initialisation d’Hermès…</span>
      </div>
    ),
  }
);

const systemIndicators = [
  {
    label: "Noyau IA",
    value: "Opérationnel",
    icon: BrainCircuit,
  },
  {
    label: "Sécurité",
    value: "Protégée",
    icon: ShieldCheck,
  },
  {
    label: "Latence",
    value: "182 ms",
    icon: Zap,
  },
];

export default function HermesPanel() {
  return (
    <section className="hermes-panel">
      <div className="hermes-panel-glow" />

      <div className="hermes-panel-header">
        <div>
          <span className="panel-eyebrow">DIRECTEUR GÉNÉRAL IA</span>
          <h2>Hermès</h2>
          <p>
            Supervision centrale de HelioSolar, coordination des agents et
            pilotage des opérations.
          </p>
        </div>

        <div className="hermes-status-badge">
          <span className="status-pulse" />
          <span>En ligne</span>
        </div>
      </div>

      <div className="hermes-panel-content">
        <div className="hermes-visual-zone">
          <div className="hermes-orbit hermes-orbit-one" />
          <div className="hermes-orbit hermes-orbit-two" />
          <div className="hermes-orbit hermes-orbit-three" />

          <div className="hermes-hologram-frame">
            <HermesHologram />
          </div>

          <div className="hermes-core-label">
            <Sparkles size={14} strokeWidth={1.8} />
            <span>HERMÈS CORE</span>
          </div>
        </div>

        <div className="hermes-insight-panel">
          <div className="hermes-insight-top">
            <div className="hermes-insight-icon">
              <CheckCircle2 size={18} strokeWidth={1.8} />
            </div>

            <div>
              <span>Analyse système</span>
              <strong>Tout fonctionne normalement</strong>
            </div>
          </div>

          <p>
            Les workflows critiques sont disponibles. Aucun incident majeur
            n’est détecté sur le noyau Hermès.
          </p>

          <div className="hermes-indicator-grid">
            {systemIndicators.map((indicator) => {
              const Icon = indicator.icon;

              return (
                <div className="hermes-indicator-card" key={indicator.label}>
                  <Icon size={17} strokeWidth={1.8} />
                  <div>
                    <span>{indicator.label}</span>
                    <strong>{indicator.value}</strong>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="hermes-command-zone">
        <div className="hermes-command-header">
          <div>
            <span className="panel-eyebrow">COMMANDE RAPIDE</span>
            <strong>Que souhaitez-vous confier à Hermès ?</strong>
          </div>

          <span className="hermes-command-shortcut">⌘ Entrée</span>
        </div>

        <div className="hermes-command-box">
          <textarea
            aria-label="Commande pour Hermès"
            placeholder="Exemple : analyse les nouveaux prospects, priorise les opportunités et prépare les actions commerciales…"
            rows={3}
          />

          <div className="hermes-command-actions">
            <div className="hermes-command-tools">
              <button type="button" aria-label="Ajouter une pièce jointe">
                <Paperclip size={18} strokeWidth={1.8} />
              </button>

              <button type="button" aria-label="Utiliser le microphone">
                <Mic size={18} strokeWidth={1.8} />
              </button>
            </div>

            <button type="button" className="hermes-send-button">
              <span>Envoyer à Hermès</span>
              <ArrowUp size={17} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
