# Hermès composer — multimodal attachments

## Phase A — LOCAL preview only (IMPLEMENTED, this PR)

The composer is a compact ChatGPT-style bar: **`[ + ] [ champ ] [ micro ] [ envoyer ]`**.
The `+` opens the native file picker (`multiple`) for images, video, audio, PDF
and common documents. Selected files are shown in the composer with a thumbnail
(image/video) or an icon + name + type + size (audio/document/other), each with a
remove button.

**Honesty boundary — nothing is transmitted.** There is no bucket, no upload
route and no multimodal orchestrator yet (see the audit summary in the PR). So:

- attachments are **browser-only** (object URLs, revoked on remove/unmount);
- the UI states plainly: *« Aperçu local — les pièces jointes ne sont pas encore
  transmises à Hermès. »*;
- **send is blocked** while any attachment is present, with:
  *« L'envoi de fichiers à Hermès arrive prochainement. Retirez la pièce jointe
  pour envoyer votre message texte maintenant. »*;
- text-only send is unchanged; the word *uploaded / envoyé / analysé / transmis*
  is never shown for a file.

Client-side validation (`lib/attachments/attachments.ts`, unit-tested) is a
**UX guard only, not a security boundary**: max files, local size cap, a
reasonable MIME/extension allowlist, executable/script refusal, name-length cap,
readable errors. Real enforcement belongs to Phase B.

## Phase B — real transmission (SEPARATE backend slice, NOT in this PR)

Make attachments stored and linked (still no model understanding required):

- **Storage**: a **private** bucket (e.g. `hermes-chat-attachments`) + RLS
  policies on `storage.objects` scoped by path prefix `tenant_id/user_id/…`.
- **Upload**: server-minted **signed upload URL** (or RLS-scoped direct upload);
  the app holds only the anon key (no service_role).
- **Metadata**: `hermes_message_attachments(tenant_id, user_id, conversation_id,
  message_id, storage_path, mime, size, checksum, provenance)` + RLS. Reuse the
  existing pattern (`juridique_documents` URL+metadata, `provenance_verified`);
  **do not** build a second document system. SW10 is reusable only as a
  *versioning* helper, not storage.
- **Orchestrator**: extend `orchestrate_hermes_message` with `p_attachments jsonb`
  (or a dedicated `attach_to_conversation` RPC) and persist refs on
  `hermes_messages`.
- **Security**: private bucket, short-TTL signed read URLs, server-side MIME
  magic-byte sniff + size caps + extension allowlist, filename sanitisation
  (anti path-traversal), tenant isolation via RLS, EXIF/geo stripping for images,
  orphan/temp cleanup (TTL), clean rejection of invalid files, no secret in the
  browser.

## Phase C — multimodal understanding (SEPARATE slice, touches n8n)

- A **vision/audio-capable model** in the resolver/agent reads the attachment via
  a signed URL.
- Requires a provider secret (server env only), an `sw23_model_catalog` entry with
  real pricing for the multimodal model, and an n8n resolver change.
- Biggest lift; gated behind its own security + cost review.

**Scope reminder:** Phase B and C are **not implemented here** and must not be
started without an explicit, separately-authorised slice.
