# Hermès Voice Interface (V1)

A ChatGPT-Voice-style layer on the Hermès command center: **microphone →
speech → real transcription → the same Hermès orchestrator → text reply →
optional spoken reply.** Voice is **only an I/O layer** — there is no second
orchestrator and no bypass of permissions or SW15.

```
Mic → SpeechRecognition (browser) → transcript
    → submitHermesMessageAction  ← SAME path as typed text
    → orchestrate_hermes_message → semantic resolver → capability registry
    → gateway → permissions → SW15 → agent/workflow → result
    → reply text (thread) → speechSynthesis (optional, sanitised)
```

## Why browser-native (Web Speech), not a server provider

The Next.js app deliberately holds **no model / provider / n8n secret** (only
the Supabase publishable key). A server-side transcription/TTS route would need
a provider secret we must not add, and audio must never carry a provider secret
to the browser. So V1 uses the **Web Speech API**: real STT
(`SpeechRecognition`) and real TTS (`speechSynthesis`), entirely in the browser,
**zero secret anywhere**, no audio upload, no new backend dependency. No
Realtime/WebSocket — no premature complexity.

## Audit (pre-build classification)

| Asset | Class | Decision |
|-------|-------|----------|
| Web Speech `SpeechRecognition` / `speechSynthesis` | VERIFIED_EXISTING | **used** (real STT + TTS) |
| `conversationId` multi-turn store, orchestrator, gateway, SW15, tenant | VERIFIED_EXISTING | **reused verbatim** |
| OpenAI transcription / TTS / Realtime, Vercel AI Gateway | MISSING | not used (no secret; constraint forbids) |
| Server-side transcription route, MediaRecorder upload | NOT_REQUIRED | avoided (would need a provider secret) |
| CSP `Permissions-Policy: microphone=()` | PARTIAL | changed to `microphone=(self)` |
| iOS Safari `SpeechRecognition` | MISSING | clean text fallback (capability detection) |
| Voice telemetry / cost sink | MISSING | reported UNAVAILABLE (never fabricated) |

## Modes (user-selected; text always available)

- `TEXT_ONLY` — no mic, no speech output.
- `VOICE_INPUT_TEXT_OUTPUT` — speak in, read the reply.
- `VOICE_INPUT_VOICE_OUTPUT` — speak in, Hermès also reads its final reply aloud.

## Mic lifecycle

`IDLE → REQUESTING_PERMISSION → LISTENING → (TRANSCRIBING) → THINKING →
SPEAKING`, plus `ERROR`. Permission denied / no mic / recogniser unavailable →
a clear message and text stays fully usable (`speechErrorMessage`). A **STOP**
button cancels TTS at any time.

## Files

| File | Role |
|------|------|
| `lib/voice/speech.ts` | Pure, DOM-free helpers: modes, capability detection, TTS sanitiser, transcript normaliser, error mapping. **Unit-tested.** |
| `lib/voice/useVoice.ts` | Client hook: real `SpeechRecognition` + `speechSynthesis` binding, fail-closed, cleanup on unmount. |
| `components/dashboard/HermesPanel.tsx` | Mode switch, mic button + live status, transcript → `send()` (same pipeline), mode-driven TTS + STOP. |
| `lib/security/headers.ts` | `Permissions-Policy: microphone=(self)` (same-origin only). |
| `tests/voice-speech.test.ts` | Node built-in test runner (`npm test`) — 14 real assertions. |

## Security

- **No client secret** — nothing provider-bearing reaches the browser; audio
  never leaves the device.
- **SW15 / permissions / tenant** enforced server-side, unchanged. A voice
  transcript is submitted exactly like typed text; it can never approve an
  action (approvals stay in the Approvals panel) and never bypass the policy
  gate. Prompt-injection phrases ("ignore SW15") are just text to the
  deterministic orchestrator — verified to not execute anything.
- **TTS never vocalises** ids, refs, URLs, opaque tokens or inline code
  (`sanitizeForSpeech`); an id-only reply is not spoken at all.
- **Never fabricates** a transcript: an empty/blank result is not submitted, and
  no confidence/language/duration field is invented.
- **Fail-closed** everywhere: unsupported browser → text; unauthenticated →
  `UNAUTHENTICATED`; provider/recogniser failure → controlled error + text.

## Testing & the browser-runtime boundary

- **Pure logic** (`lib/voice/speech.ts`): 14 real unit tests, `npm test`
  (Node `--test`, type-stripped). Covers secret-stripping, capability
  detection / iOS fallback, transcript normalisation, error mapping.
- **Orchestrator target** (real backend, impersonated via SQL): a transcript
  reaches a real `ANSWER_ONLY` (capability list), a real `ACTION → QUEUED`
  (diagnostic) and a sensitive `ACTION → QUEUED` (`btp.qualification.create`,
  approval-gated — not executed synchronously); unauthenticated →
  `UNAUTHENTICATED`; "ignore SW15" → `ANSWER_ONLY`, no bypass. All checks ran in
  rolled-back transactions — **zero fixtures persisted**.
- **Boundary (documented, not faked):** the actual mic capture and the browser
  speech-to-text engine cannot be driven in headless Chromium (no Google speech
  key) or without real audio hardware, so live "spoken audio → transcript" is a
  browser-runtime behaviour verified by design, not by an automated headless
  run — consistent with the browser-login limitation noted on earlier PRs. The
  code path from a recognised transcript onward is fully covered above.

## Observability / cost

Voice is browser-native with no server round-trip and no provider billing, so
there is no telemetry/cost sink to read. Audio duration / provider / latency /
transcription-TTS success are therefore **UNAVAILABLE** in V1 (not instrumented)
— reported honestly, never fabricated. A future server-mediated provider path
could feed the mission-critical observability layer.
