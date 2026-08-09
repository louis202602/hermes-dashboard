"use client";

import dynamic from "next/dynamic";
import { ArrowUp, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { pollAgentActionResultAction } from "@/app/actions/agent-actions";
import {
  applyHermesResolutionAction,
  submitHermesMessageAction,
} from "@/app/actions/hermes-orchestration";
import { TERMINAL_RESULT_STATUSES } from "@/types/agent-actions";

type HoloState =
  | "idle"
  | "listening"
  | "thinking"
  | "success"
  | "warning"
  | "error"
  | "offline";

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
  },
);

type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  outcome?: string;
  actionKey?: string | null;
  requestId?: string | null;
  confidence?: string | null;
  lifecycle?: string; // live gateway status for ACTION turns
  chantierId?: string | null;
};

const STATE_LABEL: Record<string, string> = {
  IDLE: "Au repos",
  SUBMITTING: "Envoi…",
  RESOLVING: "Compréhension…",
  ANSWER_ONLY: "Réponse",
  NEEDS_CLARIFICATION: "À préciser",
  QUEUED: "En file",
  RUNNING: "En cours",
  PENDING_APPROVAL: "Approbation requise",
  SUCCEEDED: "Succès",
  FAILED: "Échec",
  POLICY_DENIED: "Refusée (SW15)",
  REJECTED: "Refusée",
  TIMEOUT: "Délai dépassé",
  RPC_ERROR: "Service indisponible",
  NOT_FOUND: "Introuvable",
  VALIDATION_FAILED: "À préciser",
  UNAUTHENTICATED: "Session expirée",
  NO_TENANT: "Aucun tenant",
  ERROR: "Erreur",
};

function holoFor(state: string): HoloState {
  switch (state) {
    case "IDLE":
    case "ANSWER_ONLY":
      return "idle";
    case "SUBMITTING":
      return "listening";
    case "RESOLVING":
    case "QUEUED":
    case "RUNNING":
      return "thinking";
    case "PENDING_APPROVAL":
    case "TIMEOUT":
    case "NEEDS_CLARIFICATION":
    case "VALIDATION_FAILED":
      return "warning";
    case "SUCCEEDED":
      return "success";
    case "RPC_ERROR":
      return "offline";
    case "IDLE_DEFAULT":
      return "idle";
    default:
      return "error";
  }
}

function toneFor(state: string): "ok" | "bad" | "warn" | "pending" {
  if (state === "SUCCEEDED") return "ok";
  if (
    [
      "FAILED",
      "REJECTED",
      "POLICY_DENIED",
      "RPC_ERROR",
      "NOT_FOUND",
      "UNAUTHENTICATED",
      "NO_TENANT",
      "ERROR",
    ].includes(state)
  )
    return "bad";
  if (
    ["PENDING_APPROVAL", "TIMEOUT", "NEEDS_CLARIFICATION", "VALIDATION_FAILED"].includes(
      state,
    )
  )
    return "warn";
  return "pending";
}

function chantierId(result: unknown): string | null {
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.chantier_id === "string") return r.chantier_id;
  }
  return null;
}

function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `hermes-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function HermesPanel() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<
    { requestId: string; turnId: string } | null
  >(null);
  const [activeResolve, setActiveResolve] = useState<
    { resolveRequestId: string; conversationId: string; turnId: string } | null
  >(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // Poll the gateway for an in-flight ACTION and reflect its lifecycle on the
  // matching assistant turn. State is only set inside async callbacks (never
  // synchronously in the effect body).
  useEffect(() => {
    if (!activeAction) return;
    const { requestId, turnId } = activeAction;
    let attempts = 0;
    const max = 40; // ~60s
    const timer = setInterval(async () => {
      attempts += 1;
      const r = await pollAgentActionResultAction(requestId);
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? { ...t, lifecycle: r.status, chantierId: chantierId(r.result) }
            : t,
        ),
      );
      if (TERMINAL_RESULT_STATUSES.has(r.status) || attempts >= max) {
        clearInterval(timer);
      } else if (r.status === "TIMEOUT") {
        clearInterval(timer);
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [activeAction]);

  // Poll a semantic-resolution request (read-only) until terminal, then apply
  // it ONCE. Apply re-validates the model proposal server-side and (if valid)
  // executes via the gateway. State is only set after awaits.
  useEffect(() => {
    if (!activeResolve) return;
    const { resolveRequestId, conversationId, turnId } = activeResolve;
    let attempts = 0;
    const max = 40; // ~60s
    let applied = false;
    const timer = setInterval(async () => {
      attempts += 1;
      const r = await pollAgentActionResultAction(resolveRequestId);
      if (TERMINAL_RESULT_STATUSES.has(r.status)) {
        if (applied) return;
        applied = true;
        clearInterval(timer);
        const res = await applyHermesResolutionAction(
          conversationId,
          resolveRequestId,
          null,
        );
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  text: res.reply,
                  outcome: res.outcome,
                  actionKey: res.actionKey,
                  requestId: res.requestId,
                  confidence: res.confidence,
                  lifecycle:
                    res.outcome === "ACTION" ? res.status ?? "QUEUED" : undefined,
                }
              : t,
          ),
        );
        setActiveResolve(null);
        if (res.outcome === "ACTION" && res.requestId) {
          setActiveAction({ requestId: res.requestId, turnId });
        }
      } else if (attempts >= max) {
        clearInterval(timer);
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? { ...t, text: "Délai d’analyse dépassé. Réessayez.", outcome: "ERROR" }
              : t,
          ),
        );
        setActiveResolve(null);
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [activeResolve]);

  // Keep the newest turn in view after the list changes.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (text.length === 0 || sending) return;

    const rid = newRequestId();
    const userTurn: Turn = { id: `${rid}-u`, role: "user", text };
    setTurns((prev) => [...prev, userTurn]);
    setInput("");
    setSending(true);

    const res = await submitHermesMessageAction(text, conversationId, rid);
    setSending(false);

    if (res.conversationId) setConversationId(res.conversationId);

    const resolving = res.outcome === "RESOLVING";
    const assistantTurn: Turn = {
      id: res.assistantMessageId ?? `${rid}-a`,
      role: "assistant",
      text: res.reply,
      outcome: res.outcome,
      actionKey: res.actionKey,
      requestId: res.requestId,
      confidence: res.confidence,
      lifecycle: res.outcome === "ACTION" ? res.status ?? "QUEUED" : resolving ? "RESOLVING" : undefined,
    };
    setTurns((prev) => [...prev, assistantTurn]);

    if (res.outcome === "ACTION" && res.requestId) {
      setActiveAction({ requestId: res.requestId, turnId: assistantTurn.id });
    } else if (resolving && res.resolveRequestId && res.conversationId) {
      setActiveResolve({
        resolveRequestId: res.resolveRequestId,
        conversationId: res.conversationId,
        turnId: assistantTurn.id,
      });
    }
  }

  const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant");
  let state = "IDLE";
  if (sending) state = "SUBMITTING";
  else if (lastAssistant) {
    state = lastAssistant.lifecycle ?? lastAssistant.outcome ?? "IDLE";
  }

  const holo = holoFor(turns.length === 0 && !sending ? "IDLE" : state);
  const tone = toneFor(state);
  const label = STATE_LABEL[state] ?? state;
  const inFlight =
    sending ||
    !!activeResolve ||
    (!!activeAction &&
      (lastAssistant?.lifecycle === "QUEUED" ||
        lastAssistant?.lifecycle === "RUNNING"));

  return (
    <section className="hermes-panel">
      <div className="hermes-panel-glow" />

      <div className="hermes-panel-header">
        <div>
          <span className="panel-eyebrow">DIRECTEUR GÉNÉRAL IA</span>
          <h2>Hermès</h2>
          <p>
            Parlez à Hermès en langage naturel : il comprend votre intention,
            sélectionne une capacité autorisée et l’exécute via la passerelle
            sécurisée (permissions, SW15, audit).
          </p>
        </div>

        <div className={`hermes-status-badge is-${tone}`} data-testid="hermes-state">
          <span className="status-pulse" />
          <span>{label}</span>
        </div>
      </div>

      <div className="hermes-panel-content">
        <div className="hermes-visual-zone">
          <div className="hermes-orbit hermes-orbit-one" />
          <div className="hermes-orbit hermes-orbit-two" />
          <div className="hermes-orbit hermes-orbit-three" />

          <div className="hermes-hologram-frame">
            <HermesHologram state={holo} />
          </div>

          <div className="hermes-core-label">
            <Sparkles size={14} strokeWidth={1.8} />
            <span>HERMÈS CORE</span>
          </div>
        </div>

        <div className="hermes-insight-panel">
          <div className="hermes-insight-top">
            <div className={`hermes-insight-icon is-${tone}`}>
              <ShieldCheck size={18} strokeWidth={1.8} />
            </div>
            <div>
              <span>État Hermès</span>
              <strong>{label}</strong>
            </div>
          </div>

          <div className="hermes-thread" ref={threadRef} data-testid="hermes-thread">
            {turns.length === 0 ? (
              <p className="hermes-thread-empty">
                Exemple : « qualifie le chantier Toiture Nord », « fais un
                diagnostic », ou « que peux-tu faire ? ».
              </p>
            ) : (
              turns.map((t) => (
                <div
                  key={t.id}
                  className={`hermes-bubble is-${t.role}`}
                  data-testid={t.role === "assistant" ? "hermes-assistant" : "hermes-user"}
                  data-outcome={t.outcome ?? ""}
                >
                  <p>{t.text}</p>
                  {t.role === "assistant" && t.lifecycle ? (
                    <span className={`hermes-lifecycle is-${toneFor(t.lifecycle)}`}>
                      {STATE_LABEL[t.lifecycle] ?? t.lifecycle}
                      {t.chantierId ? ` · chantier ${t.chantierId}` : ""}
                    </span>
                  ) : null}
                  {t.role === "assistant" && t.outcome === "PENDING_APPROVAL" ? (
                    <span className="hermes-lifecycle-hint">
                      Traitez la demande dans « Approbations en attente ».
                    </span>
                  ) : null}
                  {t.role === "assistant" && t.requestId ? (
                    <span className="agent-req">Réf. {t.requestId}</span>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="hermes-command-zone">
        <div className="hermes-command-header">
          <div>
            <span className="panel-eyebrow">COMMANDE</span>
            <strong>Demandez à Hermès ou lancez une action…</strong>
          </div>
        </div>

        <div className="hermes-command-box">
          <textarea
            name="command"
            aria-label="Message pour Hermès"
            placeholder="Exemple : qualifie le chantier Toiture Atelier Nord"
            rows={3}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />

          <div className="hermes-command-actions">
            <span className="hermes-command-hint">
              Actions réelles : qualification de chantier, diagnostic. Hermès ne
              contourne jamais permissions ni SW15.
            </span>

            <button
              type="submit"
              className="hermes-send-button"
              disabled={inFlight || input.trim().length === 0}
            >
              <span>{sending ? "Envoi…" : "Envoyer à Hermès"}</span>
              <ArrowUp size={17} strokeWidth={2} />
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
