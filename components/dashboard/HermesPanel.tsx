"use client";

import {
  ArrowUp,
  Camera,
  File as FileIcon,
  FileText,
  Film,
  Image as ImageIcon,
  Mic,
  Music,
  Plus,
  ScanLine,
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
import { encodeImageFileToJpeg } from "@/lib/attachments/browserImage";
import { attachInputConfig, type AttachMenuKind } from "@/lib/attachments/scan";
import ScanDocumentModal from "@/components/dashboard/ScanDocumentModal";
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
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/locales/fr";

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

function AttachmentGlyph({ kind }: { kind: AttachmentKind }) {
  if (kind === "image") return <ImageIcon size={18} strokeWidth={1.8} />;
  if (kind === "video") return <Film size={18} strokeWidth={1.8} />;
  if (kind === "audio") return <Music size={18} strokeWidth={1.8} />;
  if (kind === "pdf" || kind === "document")
    return <FileText size={18} strokeWidth={1.8} />;
  return <FileIcon size={18} strokeWidth={1.8} />;
}

// Maps a canonical status token (logic/backend value) to its i18n label key.
// The tokens themselves are never translated — only the displayed label is.
const STATE_LABEL: Record<string, string> = {
  IDLE: "chat.state.idle",
  SUBMITTING: "chat.state.submitting",
  RESOLVING: "chat.state.resolving",
  ANSWER_ONLY: "chat.state.answerOnly",
  NEEDS_CLARIFICATION: "chat.state.needsClarification",
  QUEUED: "chat.state.queued",
  RUNNING: "chat.state.running",
  PENDING_APPROVAL: "chat.state.pendingApproval",
  SUCCEEDED: "chat.state.succeeded",
  FAILED: "chat.state.failed",
  POLICY_DENIED: "chat.state.policyDenied",
  REJECTED: "chat.state.rejected",
  TIMEOUT: "chat.state.timeout",
  RPC_ERROR: "chat.state.rpcError",
  NOT_FOUND: "chat.state.notFound",
  VALIDATION_FAILED: "chat.state.validationFailed",
  UNAUTHENTICATED: "chat.state.unauthenticated",
  NO_TENANT: "chat.state.noTenant",
  ERROR: "chat.state.error",
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
  const { t } = useI18n();

  // Display-only helpers (closures over `t`); the underlying state/kind tokens
  // are logic values and stay untranslated.
  function attachmentStateLabel(a: ComposerAttachment): string {
    switch (a.state) {
      case "UPLOADING":
        return t("chat.attach.state.uploading");
      case "UPLOADED":
        return t("chat.attach.state.ready");
      case "FAILED":
        return a.error
          ? t("chat.attach.state.failedReason", { error: a.error })
          : t("chat.attach.state.failed");
      default:
        return t("chat.attach.state.pending");
    }
  }

  function attachmentKindLabel(kind: AttachmentKind): string {
    switch (kind) {
      case "image":
        return t("chat.attach.kind.image");
      case "video":
        return t("chat.attach.kind.video");
      case "audio":
        return t("chat.attach.kind.audio");
      case "pdf":
        return t("chat.attach.kind.pdf");
      case "document":
        return t("chat.attach.kind.document");
      default:
        return t("chat.attach.kind.file");
    }
  }

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
  // "+" menu (camera / scan / photos / documents / audio) + scan modal.
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photosInputRef = useRef<HTMLInputElement>(null);
  const documentsInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
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

  // Add already-materialised File(s) as attachments and start the real upload.
  // Shared by every entry point (menu pickers, camera capture, scan-to-PDF) so
  // EVERYTHING funnels through the one canonical Phase B pipeline.
  const ingestFiles = useCallback(
    (files: File[]) => {
      const added: ComposerAttachment[] = [];
      const ignored: string[] = [];
      let current = attachmentsRef.current.length;
      for (const file of files) {
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
        for (const a of added) {
          if (a.file) void uploadOne(a.id, a.file);
        }
      }
      setAttachNote(
        ignored.length > 0
          ? t("chat.attach.ignored", { list: ignored.join(" ; ") })
          : null,
      );
    },
    [uploadOne, t],
  );

  function onFilesPicked(event: React.ChangeEvent<HTMLInputElement>) {
    const list = event.target.files;
    if (list && list.length > 0) ingestFiles(Array.from(list));
    event.target.value = ""; // allow re-picking the same file
  }

  // Camera capture → normalise to a compressed JPEG (fixes HEIC / huge photos)
  // before it enters the pipeline as a standard image attachment.
  async function onCameraPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const enc = await encodeImageFileToJpeg(file);
      const stamp = new Date();
      const name = `photo-${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")}-${String(stamp.getHours()).padStart(2, "0")}${String(stamp.getMinutes()).padStart(2, "0")}.jpg`;
      ingestFiles([new File([enc.blob], name, { type: "image/jpeg" })]);
    } catch {
      // Fallback: some browsers already deliver a usable JPEG — ingest as-is.
      ingestFiles([file]);
    }
  }

  // Route a "+" menu choice to the right native input or the scan modal.
  function chooseAttachAction(kind: AttachMenuKind | "scan") {
    setAttachMenuOpen(false);
    if (kind === "scan") {
      setScanOpen(true);
      return;
    }
    const ref =
      kind === "camera"
        ? cameraInputRef
        : kind === "photos"
          ? photosInputRef
          : kind === "documents"
            ? documentsInputRef
            : audioInputRef;
    ref.current?.click();
  }

  function onScanComplete(file: File) {
    setScanOpen(false);
    ingestFiles([file]);
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
          prev.map((turn) =>
            turn.id === turnId
              ? {
                  ...turn,
                  // Honest: the request was accepted and queued, but no result
                  // came back in time. Never presented as a failure of intent or
                  // as a (fake) success.
                  text: t("chat.timeout.message"),
                  outcome: "TIMEOUT",
                  lifecycle: undefined,
                }
              : turn,
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
  }, [activeResolve, speakReply, t]);

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
      setAttachNote(t("chat.attach.uploadingBlock"));
      return;
    }
    if (attachments.some((a) => a.state === "FAILED")) {
      setAttachNote(t("chat.attach.failedBlock"));
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
      setAttachNote(t("chat.attach.uploadingBlock"));
      return;
    }
    if (current.some((a) => a.state === "FAILED")) {
      setAttachNote(t("chat.attach.failedBlock"));
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
            prev.map((turn) =>
              turn.id === userTurn.id
                ? {
                    ...turn,
                    attachmentNote: t("chat.attach.linkPartial", {
                      linked: link.linked,
                      requested: link.requested,
                    }),
                  }
                : turn,
            ),
          );
        }
      } else {
        setTurns((prev) =>
          prev.map((turn) =>
            turn.id === userTurn.id
              ? {
                  ...turn,
                  attachmentNote: t("chat.attach.linkFailed"),
                }
              : turn,
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
  const label = STATE_LABEL[state] ? t(STATE_LABEL[state] as MessageKey) : state;
  const inFlight =
    sending ||
    !!activeResolve ||
    (!!activeAction &&
      (lastAssistant?.lifecycle === "QUEUED" ||
        lastAssistant?.lifecycle === "RUNNING"));
  // The "Hermès is composing a reply" window: while the message is being sent or the
  // resolver is still thinking (BEFORE the answer text lands). An animated typing
  // indicator shows in the thread during this window — the little life the chat was
  // missing. Action queue/running already has its own lifecycle badge, so it is excluded.
  const thinking = sending || !!activeResolve;
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
          <span className="panel-eyebrow">{t("chat.header.eyebrow")}</span>
          <h2>Hermès</h2>
          <p>{t("chat.header.intro")}</p>
        </div>

        <div className="hermes-head-meta">
          <div className={`hermes-status-badge is-${tone}`} data-testid="hermes-state">
            <span className="status-pulse" />
            <span>{label}</span>
          </div>
          <span className="hermes-conn" title={t("chat.conn.title")}>
            <ShieldCheck size={12} strokeWidth={2} />
            <span>{t("chat.conn.label")}</span>
          </span>
        </div>
      </div>

      <div className="hermes-exec-grid">
        {/* PRIMARY — interact with Hermès (the real centre of this block). */}
        <form onSubmit={handleSubmit} className="hermes-command-zone">
          <span className="panel-eyebrow hermes-composer-eyebrow">
            {t("chat.composer.eyebrow")}
          </span>

          <textarea
            name="command"
            aria-label={t("chat.composer.ariaLabel")}
            className="hermes-composer-input"
            placeholder={t("chat.composer.placeholder")}
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
                        title={t("chat.attach.retryTitle")}
                      >
                        {t("common.retry")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="hermes-attachment-remove"
                      onClick={() => removeAttachment(a.id)}
                      aria-label={t("chat.attach.removeAria", { name: a.name })}
                      title={t("chat.attach.removeTitle")}
                    >
                      <X size={13} strokeWidth={2} />
                    </button>
                  </li>
                ))}
              </ul>
              <p className="hermes-attachment-note">{t("chat.attach.uploadedNote")}</p>
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
                      : t("chat.voice.listening")
                    : voice.speaking
                      ? t("chat.voice.speaking")
                      : micRequested
                        ? t("chat.voice.permission")
                        : t("chat.voice.thinking")}
              </span>
              {voice.speaking ? (
                <button
                  type="button"
                  className="hermes-voice-stop"
                  onClick={() => voice.cancelSpeech()}
                  data-testid="hermes-voice-stop"
                >
                  <Square size={13} strokeWidth={2} />
                  <span>{t("chat.voice.stop")}</span>
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="hermes-command-actions">
            {/* Read-aloud is a discreet, secondary toggle. */}
            <div className="hermes-command-left">
              {/* "+" — opens a capture/pick menu; every choice ends up in the
                  same Phase B upload pipeline. */}
              <div className="hermes-attach">
                <button
                  type="button"
                  className={`hermes-plus-button${attachMenuOpen ? " is-open" : ""}`}
                  onClick={() => setAttachMenuOpen((v) => !v)}
                  aria-label={t("chat.attach.addAria")}
                  aria-haspopup="menu"
                  aria-expanded={attachMenuOpen}
                  title={t("chat.attach.addTitle")}
                  data-testid="hermes-plus-button"
                >
                  <Plus size={17} strokeWidth={2.2} />
                </button>
                {attachMenuOpen ? (
                  <>
                    <button
                      type="button"
                      className="hermes-attach-scrim"
                      aria-label={t("chat.attach.closeMenuAria")}
                      onClick={() => setAttachMenuOpen(false)}
                    />
                    <div className="hermes-attach-menu" role="menu" data-testid="hermes-attach-menu">
                      <button type="button" role="menuitem" onClick={() => chooseAttachAction("camera")} data-testid="attach-camera">
                        <Camera size={16} strokeWidth={1.8} />
                        <span>{t("chat.attach.menu.camera")}</span>
                      </button>
                      <button type="button" role="menuitem" onClick={() => chooseAttachAction("scan")} data-testid="attach-scan">
                        <ScanLine size={16} strokeWidth={1.8} />
                        <span>{t("chat.attach.menu.scan")}</span>
                      </button>
                      <button type="button" role="menuitem" onClick={() => chooseAttachAction("photos")} data-testid="attach-photos">
                        <ImageIcon size={16} strokeWidth={1.8} />
                        <span>{t("chat.attach.menu.photos")}</span>
                      </button>
                      <button type="button" role="menuitem" onClick={() => chooseAttachAction("documents")} data-testid="attach-documents">
                        <FileText size={16} strokeWidth={1.8} />
                        <span>{t("chat.attach.menu.documents")}</span>
                      </button>
                      <button type="button" role="menuitem" onClick={() => chooseAttachAction("audio")} data-testid="attach-audio">
                        <Music size={16} strokeWidth={1.8} />
                        <span>{t("chat.attach.menu.audio")}</span>
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
              {/* Dedicated native inputs — camera (single, rear), then the
                  category pickers. Video is never offered (out of V1). */}
              <input
                ref={cameraInputRef}
                type="file"
                accept={attachInputConfig("camera").accept}
                capture="environment"
                onChange={onCameraPhoto}
                className="hermes-file-input"
                tabIndex={-1}
                aria-hidden="true"
                data-testid="hermes-camera-input"
              />
              <input
                ref={photosInputRef}
                type="file"
                accept={attachInputConfig("photos").accept}
                multiple
                onChange={onFilesPicked}
                className="hermes-file-input"
                tabIndex={-1}
                aria-hidden="true"
                data-testid="hermes-photos-input"
              />
              <input
                ref={documentsInputRef}
                type="file"
                accept={attachInputConfig("documents").accept}
                multiple
                onChange={onFilesPicked}
                className="hermes-file-input"
                tabIndex={-1}
                aria-hidden="true"
                data-testid="hermes-documents-input"
              />
              <input
                ref={audioInputRef}
                type="file"
                accept={attachInputConfig("audio").accept}
                multiple
                onChange={onFilesPicked}
                className="hermes-file-input"
                tabIndex={-1}
                aria-hidden="true"
                data-testid="hermes-audio-input"
              />
              {voice.support.tts ? (
                <button
                  type="button"
                  className={`hermes-io-toggle${readAloud ? " is-on" : ""}`}
                  onClick={toggleReadAloud}
                  aria-pressed={readAloud}
                  title={
                    readAloud
                      ? t("chat.voice.readAloud.on")
                      : t("chat.voice.readAloud.off")
                  }
                  data-testid="hermes-readaloud-toggle"
                >
                  <Volume2 size={15} strokeWidth={1.9} />
                </button>
              ) : null}
              <span className="hermes-command-hint">
                {t("chat.composer.hint")}
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
                  title={
                    voice.listening
                      ? t("chat.voice.mic.stop")
                      : t("chat.voice.mic.start")
                  }
                  aria-label={
                    voice.listening
                      ? t("chat.voice.mic.stop")
                      : t("chat.voice.mic.start")
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
                    ? t("chat.attach.uploadingBlock")
                    : attachmentsHaveError
                      ? t("chat.attach.failedBlock")
                      : undefined
                }
              >
                <span>{sending ? t("chat.composer.sending") : t("chat.composer.send")}</span>
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
              <span>{t("chat.insight.state")}</span>
              <strong>{label}</strong>
            </div>
          </div>

          <div className="hermes-thread" ref={threadRef} data-testid="hermes-thread">
            {turns.length === 0 && !thinking ? (
              <p className="hermes-thread-empty">{t("chat.thread.empty")}</p>
            ) : (
              <>
              {turns.map((turn) => (
                <div
                  key={turn.id}
                  className={`hermes-bubble is-${turn.role}`}
                  data-testid={turn.role === "assistant" ? "hermes-assistant" : "hermes-user"}
                  data-outcome={turn.outcome ?? ""}
                >
                  <p>{turn.text}</p>
                  {turn.role === "user" && turn.attachmentNames?.length ? (
                    <span className="hermes-bubble-attachments">
                      {turn.attachmentNames.map((n, i) => (
                        <span key={`${turn.id}-att-${i}`} className="hermes-bubble-attachment">
                          <FileIcon size={11} strokeWidth={2} />
                          {n}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {turn.role === "user" && turn.attachmentNote ? (
                    <span className="hermes-bubble-attachment-note">{turn.attachmentNote}</span>
                  ) : null}
                  {turn.role === "assistant" && turn.lifecycle ? (
                    <span className={`hermes-lifecycle is-${toneFor(turn.lifecycle)}`}>
                      {STATE_LABEL[turn.lifecycle]
                        ? t(STATE_LABEL[turn.lifecycle] as MessageKey)
                        : turn.lifecycle}
                      {turn.chantierId
                        ? ` · ${t("chat.lifecycle.worksite", { id: turn.chantierId })}`
                        : ""}
                    </span>
                  ) : null}
                  {turn.role === "assistant" && turn.lifecycle === "PENDING_APPROVAL" ? (
                    <span className="hermes-lifecycle-hint">
                      {t("chat.approval.hint")}
                    </span>
                  ) : null}
                  {turn.role === "assistant" && turn.requestId ? (
                    <span className="agent-req">
                      {t("chat.ref", { id: turn.requestId })}
                    </span>
                  ) : null}
                  {turn.role === "assistant" && turn.outcome === "ERROR" && turn.userText ? (
                    <button
                      type="button"
                      className="hermes-retry-button"
                      disabled={inFlight}
                      onClick={() => send(turn.userText as string)}
                    >
                      {t("common.retry")}
                    </button>
                  ) : null}
                </div>
              ))}
              {thinking ? (
                <div
                  className="hermes-bubble is-assistant hermes-typing"
                  data-testid="hermes-typing"
                  aria-live="polite"
                >
                  <span className="hermes-typing-dots" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </span>
                  <span className="hermes-typing-text">{t("chat.voice.thinking")}</span>
                </div>
              ) : null}
              </>
            )}
          </div>
        </aside>
      </div>

      {scanOpen ? (
        <ScanDocumentModal onComplete={onScanComplete} onClose={() => setScanOpen(false)} />
      ) : null}
    </section>
  );
}
