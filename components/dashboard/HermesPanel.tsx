"use client";

import {
  ArrowUp,
  File as FileIcon,
  FileText,
  Film,
  Image as ImageIcon,
  Mic,
  Music,
  Plus,
  ShieldCheck,
  Square,
  Volume2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { pollAgentActionResultAction } from "@/app/actions/agent-actions";
import {
  linkHermesAttachmentsAction,
  uploadHermesAttachmentAction,
} from "@/app/actions/hermes-attachments";
import {
  applyHermesResolutionAction,
  submitHermesMessageAction,
} from "@/app/actions/hermes-orchestration";
import {
  formatBytes,
  isPreviewable,
  kindFor,
  validateFiles,
  type AttachmentKind,
  type FileMeta,
} from "@/lib/attachments/attachments";
import { ATTACHMENT_ACCEPT_V1 } from "@/lib/attachments/serverValidate";
import type { AttachmentUploadState } from "@/types/hermes-attachments";
import { useVoice } from "@/lib/voice/useVoice";
import {
  isVoiceInputMode,
  isVoiceOutputMode,
  normalizeTranscript,
  sanitizeForSpeech,
  type VoiceMode,
  type VoicePhase,
} from "@/lib/voice/speech";
import { TERMINAL_RESULT_STATUSES } from "@/types/agent-actions";

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
  userText?: string; // the user message that produced this turn (for retry)
  attachmentNames?: string[]; // filenames attached to this user turn
  attachmentNote?: string; // honest note if linking failed after send
};

// A composer attachment (Phase B — really uploaded). `state` is the TRANSPORT
// lifecycle only: LOCAL → UPLOADING → UPLOADED (stored privately, not yet
// linked) → FAILED. It is never "sent"/"analysed"/"understood" (that is the
// forbidden Phase C). `url` is a browser object URL for an image/video
// thumbnail, revoked on remove/unmount. `file` is retained so a FAILED upload
// can be retried. `attachmentId` is the server id once UPLOADED.
type ComposerAttachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  kind: AttachmentKind;
  url?: string;
  state: AttachmentUploadState;
  attachmentId?: string;
  error?: string;
  file?: File;
};

// Honest, user-facing wording.
const ATTACH_UPLOADING_MSG =
  "Téléversement en cours — patientez avant d’envoyer votre message.";
const ATTACH_FAILED_MSG =
  "Une pièce jointe n’a pas pu être téléversée. Retirez-la ou réessayez avant d’envoyer.";
// The files ARE transmitted (private, per-organisation isolated storage) but are
// NOT analysed by Hermès yet — that stays honest about the current capability.
const ATTACH_UPLOADED_NOTE =
  "Pièces jointes téléversées en privé (stockage isolé par organisation). Elles ne sont pas encore analysées par Hermès.";

function attachmentStateLabel(a: ComposerAttachment): string {
  switch (a.state) {
    case "UPLOADING":
      return "Téléversement…";
    case "UPLOADED":
      return "Prête";
    case "FAILED":
      return a.error ? `Échec — ${a.error}` : "Échec";
    default:
      return "En attente";
  }
}

function attachmentKindLabel(kind: AttachmentKind): string {
  switch (kind) {
    case "image":
      return "Image";
    case "video":
      return "Vidéo";
    case "audio":
      return "Audio";
    case "pdf":
      return "PDF";
    case "document":
      return "Document";
    default:
      return "Fichier";
  }
}

function AttachmentGlyph({ kind }: { kind: AttachmentKind }) {
  if (kind === "image") return <ImageIcon size={18} strokeWidth={1.8} />;
  if (kind === "video") return <Film size={18} strokeWidth={1.8} />;
  if (kind === "audio") return <Music size={18} strokeWidth={1.8} />;
  if (kind === "pdf" || kind === "document")
    return <FileText size={18} strokeWidth={1.8} />;
  return <FileIcon size={18} strokeWidth={1.8} />;
}

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
  POLICY_DENIED: "Refusée (sécurité)",
  REJECTED: "Refusée",
  TIMEOUT: "Délai dépassé",
  RPC_ERROR: "Service indisponible",
  NOT_FOUND: "Introuvable",
  VALIDATION_FAILED: "À préciser",
  UNAUTHENTICATED: "Session expirée",
  NO_TENANT: "Aucun tenant",
  ERROR: "Erreur",
};

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

  // --- Composer attachments (Phase B — really uploaded) ---------------------
  // The "+" picks files that are validated + uploaded SERVER-SIDE to a private,
  // per-organisation isolated bucket. The UI reflects the honest TRANSPORT state
  // (UPLOADING / UPLOADED / FAILED) — never "analysed". Send is allowed once all
  // attachments are UPLOADED; blocked while any is uploading or failed.
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachNote, setAttachNote] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  // Revoke any object URLs when the panel unmounts (thumbnails are local).
  useEffect(() => {
    return () => {
      for (const a of attachmentsRef.current) {
        if (a.url) URL.revokeObjectURL(a.url);
      }
    };
  }, []);

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  // Upload one file and reflect its transport state on the matching entry.
  const uploadOne = useCallback(async (id: string, file: File) => {
    const others = attachmentsRef.current.filter((a) => a.id !== id);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("existingCount", String(others.length));
    fd.append(
      "existingTotalBytes",
      String(others.reduce((sum, a) => sum + a.size, 0)),
    );
    const res = await uploadHermesAttachmentAction(fd);
    setAttachments((prev) =>
      prev.map((a) =>
        a.id === id
          ? res.ok
            ? { ...a, state: "UPLOADED", attachmentId: res.attachmentId, error: undefined }
            : { ...a, state: "FAILED", error: res.reason }
          : a,
      ),
    );
  }, []);

  function onFilesPicked(event: React.ChangeEvent<HTMLInputElement>) {
    const list = event.target.files;
    if (!list || list.length === 0) return;
    const added: ComposerAttachment[] = [];
    const ignored: string[] = [];
    let current = attachments.length;
    for (const file of Array.from(list)) {
      const meta: FileMeta = { name: file.name, size: file.size, type: file.type };
      const { accepted, errors } = validateFiles([meta], current);
      if (accepted.length === 1) {
        const kind = kindFor(meta);
        const url = isPreviewable(kind) ? URL.createObjectURL(file) : undefined;
        added.push({
          id: newRequestId(),
          name: file.name,
          size: file.size,
          type: file.type,
          kind,
          url,
          state: "UPLOADING",
          file,
        });
        current += 1;
      } else if (errors.length > 0) {
        ignored.push(`${errors[0].name} (${errors[0].reason})`);
      }
    }
    if (added.length > 0) {
      setAttachments((prev) => [...prev, ...added]);
      // Kick off the real uploads (state → UPLOADED / FAILED as each settles).
      for (const a of added) {
        if (a.file) void uploadOne(a.id, a.file);
      }
    }
    setAttachNote(
      ignored.length > 0 ? `Fichier(s) ignoré(s) : ${ignored.join(" ; ")}` : null,
    );
    // Reset so re-picking the same file fires onChange again.
    event.target.value = "";
  }

  function retryAttachment(id: string) {
    const target = attachmentsRef.current.find((a) => a.id === id);
    if (!target?.file) return;
    setAttachments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, state: "UPLOADING", error: undefined } : a)),
    );
    void uploadOne(id, target.file);
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.url) URL.revokeObjectURL(target.url);
      return prev.filter((a) => a.id !== id);
    });
    setAttachNote(null);
  }

  function clearAttachments() {
    setAttachments((prev) => {
      for (const a of prev) if (a.url) URL.revokeObjectURL(a.url);
      return [];
    });
    setAttachNote(null);
  }

  // --- Voice I/O (browser-native; no provider secret) ---------------------
  // Voice is purely an input/output layer over the SAME orchestrator pipeline.
  // The transcript is submitted exactly like typed text; TTS only reads the
  // final reply and never approves, never bypasses SW15.
  // Voice output ("lire les réponses à voix haute") is a discreet persistent
  // toggle; voice input (mic) is press-to-talk. The three technical VoiceModes
  // still drive the pipeline exactly as before, but are DERIVED from these —
  // never exposed to the user as a mode selector.
  const [readAloud, setReadAloud] = useState(false);
  const [micRequested, setMicRequested] = useState(false);
  const voice = useVoice();
  const voiceMode: VoiceMode = !voice.support.stt
    ? "TEXT_ONLY"
    : readAloud && voice.support.tts
      ? "VOICE_INPUT_VOICE_OUTPUT"
      : "VOICE_INPUT_TEXT_OUTPUT";
  // Refs so async flows (send / resolve effect) read the latest mode + voice
  // handles without widening effect dependencies.
  const voiceModeRef = useRef(voiceMode);
  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceModeRef.current = voiceMode;
    voiceRef.current = voice;
  });

  // Speak Hermès' final reply when the active mode requests voice output.
  const speakReply = useCallback((reply: string) => {
    const mode = voiceModeRef.current;
    const v = voiceRef.current;
    if (!isVoiceOutputMode(mode) || !v.support.tts) return;
    const spoken = sanitizeForSpeech(reply);
    if (spoken) v.speak(spoken);
  }, []);

  // Poll the gateway for an in-flight ACTION and reflect its lifecycle on the
  // matching assistant turn. State is only set inside async callbacks (never
  // synchronously in the effect body).
  useEffect(() => {
    if (!activeAction) return;
    const { requestId, turnId } = activeAction;
    let attempts = 0;
    // Longer window so a PENDING_APPROVAL action resumes automatically in the
    // conversation once it is approved in the Approvals panel (~5 min cap).
    const max = 200;
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
      if (
        TERMINAL_RESULT_STATUSES.has(r.status) ||
        r.status === "TIMEOUT" ||
        attempts >= max
      ) {
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
        // The resolved answer is the final reply for this turn — speak it.
        speakReply(res.reply);
      } else if (attempts >= max) {
        clearInterval(timer);
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  // Honest: the request was accepted and queued, but no result
                  // came back in time. Never presented as a failure of intent or
                  // as a (fake) success.
                  text:
                    "Votre demande a bien été reçue et mise en file, mais n’a pas encore été traitée (délai d’attente dépassé). Réessayez plus tard.",
                  outcome: "TIMEOUT",
                  lifecycle: undefined,
                }
              : t,
          ),
        );
        setActiveResolve(null);
      } else {
        // Reflect the real, honest queue status while waiting (QUEUED / RUNNING)
        // instead of a static "analyse en cours".
        setTurns((prev) =>
          prev.map((t) => (t.id === turnId ? { ...t, lifecycle: r.status } : t)),
        );
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [activeResolve, speakReply]);

  // Keep the newest turn in view after the list changes.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (text.length === 0 || sending) return;
    if (attachments.some((a) => a.state === "UPLOADING")) {
      setAttachNote(ATTACH_UPLOADING_MSG);
      return;
    }
    if (attachments.some((a) => a.state === "FAILED")) {
      setAttachNote(ATTACH_FAILED_MSG);
      return;
    }
    setInput("");
    await send(text);
  }

  async function send(text: string) {
    if (text.length === 0 || sending) return;
    const current = attachmentsRef.current;
    // Block only on in-flight or failed uploads. UPLOADED attachments are sent.
    if (current.some((a) => a.state === "UPLOADING")) {
      setAttachNote(ATTACH_UPLOADING_MSG);
      return;
    }
    if (current.some((a) => a.state === "FAILED")) {
      setAttachNote(ATTACH_FAILED_MSG);
      return;
    }
    const uploaded = current.filter(
      (a) => a.state === "UPLOADED" && a.attachmentId,
    );

    setMicRequested(false);
    const rid = newRequestId();
    const userTurn: Turn = {
      id: `${rid}-u`,
      role: "user",
      text,
      attachmentNames: uploaded.length > 0 ? uploaded.map((a) => a.name) : undefined,
    };
    setTurns((prev) => [...prev, userTurn]);
    setSending(true);

    const res = await submitHermesMessageAction(text, conversationId, rid);
    setSending(false);

    if (res.conversationId) setConversationId(res.conversationId);

    // Link uploaded attachments to the now-persisted user message. Honest
    // outcome: only clear + confirm when EVERY attachment was linked; otherwise
    // annotate the turn without claiming a false success.
    if (uploaded.length > 0) {
      if (res.userMessageId && res.conversationId) {
        const link = await linkHermesAttachmentsAction(
          res.conversationId,
          res.userMessageId,
          uploaded.map((a) => a.attachmentId as string),
        );
        if (!link.ok) {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === userTurn.id
                ? {
                    ...t,
                    attachmentNote: `Message envoyé. ${link.linked}/${link.requested} pièce(s) jointe(s) rattachée(s) — les autres n’ont pas pu l’être.`,
                  }
                : t,
            ),
          );
        }
      } else {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === userTurn.id
              ? {
                  ...t,
                  attachmentNote:
                    "Message envoyé, mais les pièces jointes n’ont pas pu être rattachées.",
                }
              : t,
          ),
        );
      }
      clearAttachments();
    }

    const resolving = res.outcome === "RESOLVING";
    const assistantTurn: Turn = {
      id: res.assistantMessageId ?? `${rid}-a`,
      role: "assistant",
      text: res.reply,
      outcome: res.outcome,
      actionKey: res.actionKey,
      requestId: res.requestId,
      confidence: res.confidence,
      userText: text,
      lifecycle: res.outcome === "ACTION" ? res.status ?? "QUEUED" : resolving ? "RESOLVING" : undefined,
    };
    setTurns((prev) => [...prev, assistantTurn]);

    if (res.outcome === "ACTION" && res.requestId) {
      setActiveAction({ requestId: res.requestId, turnId: assistantTurn.id });
      speakReply(res.reply);
    } else if (resolving && res.resolveRequestId && res.conversationId) {
      setActiveResolve({
        resolveRequestId: res.resolveRequestId,
        conversationId: res.conversationId,
        turnId: assistantTurn.id,
      });
      // Resolving is async — the final answer is spoken once it settles.
    } else {
      // ANSWER_ONLY / NEEDS_CLARIFICATION / PENDING_APPROVAL / ERROR: this reply
      // is final for the turn, so it is the one to read aloud (if voice output).
      speakReply(res.reply);
    }
  }

  const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant");
  let state = "IDLE";
  if (sending) state = "SUBMITTING";
  else if (lastAssistant) {
    state = lastAssistant.lifecycle ?? lastAssistant.outcome ?? "IDLE";
  }

  const tone = toneFor(state);
  const label = STATE_LABEL[state] ?? state;
  const inFlight =
    sending ||
    !!activeResolve ||
    (!!activeAction &&
      (lastAssistant?.lifecycle === "QUEUED" ||
        lastAssistant?.lifecycle === "RUNNING"));
  // Send is blocked while any attachment is still uploading or has failed;
  // UPLOADED attachments are transmitted with the message.
  const attachmentsBusy = attachments.some((a) => a.state === "UPLOADING");
  const attachmentsHaveError = attachments.some((a) => a.state === "FAILED");

  // --- Voice controls ------------------------------------------------------
  const voiceInputActive = isVoiceInputMode(voiceMode);
  const canListen = voice.support.stt;

  function toggleReadAloud() {
    setReadAloud((on) => {
      const next = !on;
      // Disabling stops any in-progress speech immediately.
      if (!next) voice.cancelSpeech();
      return next;
    });
  }

  async function handleFinalTranscript(raw: string) {
    setMicRequested(false);
    const text = normalizeTranscript(raw);
    if (text.length === 0) return; // never fabricate a message
    await send(text);
  }

  function handleMicClick() {
    if (!canListen || inFlight) return;
    if (voice.listening) {
      setMicRequested(false);
      voice.stopListening();
      return;
    }
    voice.clearError();
    setMicRequested(true);
    voice.startListening(handleFinalTranscript);
  }

  // Voice pipeline phase (mic + speech), derived from live hook state.
  let micPhase: VoicePhase = "IDLE";
  if (voice.speaking) micPhase = "SPEAKING";
  else if (voice.listening) micPhase = "LISTENING";
  else if (voice.error) micPhase = "ERROR";
  else if (inFlight && voiceInputActive) micPhase = "THINKING";
  else if (micRequested) micPhase = "REQUESTING_PERMISSION";

  return (
    <section className="hermes-panel hermes-panel-exec">
      <div className="hermes-panel-header">
        <div className="hermes-head-titles">
          <span className="panel-eyebrow">DIRECTEUR GÉNÉRAL IA</span>
          <h2>Hermès</h2>
          <p>
            Décrivez votre intention en langage naturel : Hermès sélectionne une
            action autorisée et l’exécute en toute sécurité — vos permissions et
            un journal d’audit s’appliquent toujours.
          </p>
        </div>

        <div className="hermes-head-meta">
          <div className={`hermes-status-badge is-${tone}`} data-testid="hermes-state">
            <span className="status-pulse" />
            <span>{label}</span>
          </div>
          <span
            className="hermes-conn"
            title="Connecté au backend Hermès — données réelles"
          >
            <ShieldCheck size={12} strokeWidth={2} />
            <span>Connecté à hermes_os</span>
          </span>
        </div>
      </div>

      <div className="hermes-exec-grid">
        {/* PRIMARY — interact with Hermès (the real centre of this block). */}
        <form onSubmit={handleSubmit} className="hermes-command-zone">
          <span className="panel-eyebrow hermes-composer-eyebrow">
            Demander à Hermès
          </span>

          <textarea
            name="command"
            aria-label="Message pour Hermès"
            className="hermes-composer-input"
            placeholder="Demandez à Hermès — ex. « qualifie le chantier Toiture Atelier Nord »"
            rows={2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />

          {/* Attachment previews (Phase B) — thumbnails for image/video, icon +
              name + size otherwise, plus the honest TRANSPORT state; each is
              removable and a failed upload can be retried. */}
          {attachments.length > 0 ? (
            <div className="hermes-attachments" data-testid="hermes-attachments">
              <ul className="hermes-attachment-list">
                {attachments.map((a) => (
                  <li
                    key={a.id}
                    className={`hermes-attachment is-${a.kind} is-${a.state.toLowerCase()}`}
                    data-state={a.state}
                  >
                    <span className="hermes-attachment-thumb">
                      {a.url && a.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.url} alt="" />
                      ) : a.url && a.kind === "video" ? (
                        <video src={a.url} muted playsInline preload="metadata" />
                      ) : (
                        <AttachmentGlyph kind={a.kind} />
                      )}
                    </span>
                    <span className="hermes-attachment-meta">
                      <strong title={a.name}>{a.name}</strong>
                      <span>
                        {attachmentKindLabel(a.kind)} · {formatBytes(a.size)}
                      </span>
                      <span
                        className={`hermes-attachment-state is-${a.state.toLowerCase()}`}
                      >
                        {attachmentStateLabel(a)}
                      </span>
                    </span>
                    {a.state === "FAILED" ? (
                      <button
                        type="button"
                        className="hermes-attachment-retry"
                        onClick={() => retryAttachment(a.id)}
                        title="Réessayer le téléversement"
                      >
                        Réessayer
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="hermes-attachment-remove"
                      onClick={() => removeAttachment(a.id)}
                      aria-label={`Retirer ${a.name}`}
                      title="Retirer"
                    >
                      <X size={13} strokeWidth={2} />
                    </button>
                  </li>
                ))}
              </ul>
              <p className="hermes-attachment-note">{ATTACH_UPLOADED_NOTE}</p>
            </div>
          ) : null}
          {attachNote ? (
            <p className="hermes-attachment-alert" role="status">
              {attachNote}
            </p>
          ) : null}

          {/* Voice feedback is contextual — only while the mic or speech is
              actually active, never a permanent panel. */}
          {micPhase !== "IDLE" ? (
            <div
              className={`hermes-voice-status is-${micPhase.toLowerCase()}`}
              data-testid="hermes-voice-status"
              data-phase={micPhase}
              aria-live="polite"
            >
              <span className="hermes-voice-dot" />
              <span className="hermes-voice-text">
                {voice.error
                  ? voice.error
                  : voice.listening
                    ? voice.interim
                      ? `« ${voice.interim} »`
                      : "Écoute… parlez maintenant."
                    : voice.speaking
                      ? "Hermès parle…"
                      : micRequested
                        ? "Autorisation micro…"
                        : "Analyse en cours…"}
              </span>
              {voice.speaking ? (
                <button
                  type="button"
                  className="hermes-voice-stop"
                  onClick={() => voice.cancelSpeech()}
                  data-testid="hermes-voice-stop"
                >
                  <Square size={13} strokeWidth={2} />
                  <span>Stop</span>
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="hermes-command-actions">
            {/* Read-aloud is a discreet, secondary toggle. */}
            <div className="hermes-command-left">
              {/* "+" — pick files for a LOCAL preview (Phase A, never sent). */}
              <button
                type="button"
                className="hermes-plus-button"
                onClick={openFilePicker}
                aria-label="Ajouter une pièce jointe"
                title="Ajouter une pièce jointe — image, PDF, document ou audio"
                data-testid="hermes-plus-button"
              >
                <Plus size={17} strokeWidth={2.2} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ATTACHMENT_ACCEPT_V1}
                multiple
                onChange={onFilesPicked}
                className="hermes-file-input"
                tabIndex={-1}
                aria-hidden="true"
                data-testid="hermes-file-input"
              />
              {voice.support.tts ? (
                <button
                  type="button"
                  className={`hermes-io-toggle${readAloud ? " is-on" : ""}`}
                  onClick={toggleReadAloud}
                  aria-pressed={readAloud}
                  title={
                    readAloud
                      ? "Réponses lues à voix haute — désactiver"
                      : "Lire les réponses à voix haute"
                  }
                  data-testid="hermes-readaloud-toggle"
                >
                  <Volume2 size={15} strokeWidth={1.9} />
                </button>
              ) : null}
              <span className="hermes-command-hint">
                Vos permissions et un journal d’audit s’appliquent à chaque action.
              </span>
            </div>

            {/* Mic = "parler à Hermès" (press-to-talk); send stays clear. */}
            <div className="hermes-command-buttons">
              {voice.support.stt ? (
                <button
                  type="button"
                  className={`hermes-mic-button${
                    voice.listening ? " is-listening" : ""
                  }`}
                  onClick={handleMicClick}
                  disabled={inFlight}
                  aria-pressed={voice.listening}
                  title={voice.listening ? "Arrêter l’écoute" : "Parler à Hermès"}
                  aria-label={
                    voice.listening ? "Arrêter l’écoute" : "Parler à Hermès"
                  }
                  data-testid="hermes-mic-button"
                >
                  {voice.listening ? (
                    <Square size={16} strokeWidth={2} />
                  ) : (
                    <Mic size={16} strokeWidth={2} />
                  )}
                </button>
              ) : null}

              <button
                type="submit"
                className="hermes-send-button"
                disabled={
                  inFlight ||
                  input.trim().length === 0 ||
                  attachmentsBusy ||
                  attachmentsHaveError
                }
                title={
                  attachmentsBusy
                    ? ATTACH_UPLOADING_MSG
                    : attachmentsHaveError
                      ? ATTACH_FAILED_MSG
                      : undefined
                }
              >
                <span>{sending ? "Envoi…" : "Envoyer"}</span>
                <ArrowUp size={16} strokeWidth={2} />
              </button>
            </div>
          </div>
        </form>

        {/* SECONDARY — live state + recent turns (compact, never the centre). */}
        <aside className="hermes-insight-panel">
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
                  {t.role === "user" && t.attachmentNames?.length ? (
                    <span className="hermes-bubble-attachments">
                      {t.attachmentNames.map((n, i) => (
                        <span key={`${t.id}-att-${i}`} className="hermes-bubble-attachment">
                          <FileIcon size={11} strokeWidth={2} />
                          {n}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {t.role === "user" && t.attachmentNote ? (
                    <span className="hermes-bubble-attachment-note">{t.attachmentNote}</span>
                  ) : null}
                  {t.role === "assistant" && t.lifecycle ? (
                    <span className={`hermes-lifecycle is-${toneFor(t.lifecycle)}`}>
                      {STATE_LABEL[t.lifecycle] ?? t.lifecycle}
                      {t.chantierId ? ` · chantier ${t.chantierId}` : ""}
                    </span>
                  ) : null}
                  {t.role === "assistant" && t.lifecycle === "PENDING_APPROVAL" ? (
                    <span className="hermes-lifecycle-hint">
                      Approbation humaine requise — traitez la demande dans «
                      Approbations en attente » ci-dessous ; la conversation
                      reprendra automatiquement après décision.
                    </span>
                  ) : null}
                  {t.role === "assistant" && t.requestId ? (
                    <span className="agent-req">Réf. {t.requestId}</span>
                  ) : null}
                  {t.role === "assistant" && t.outcome === "ERROR" && t.userText ? (
                    <button
                      type="button"
                      className="hermes-retry-button"
                      disabled={inFlight}
                      onClick={() => send(t.userText as string)}
                    >
                      Réessayer
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
