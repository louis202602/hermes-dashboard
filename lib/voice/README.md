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
(`SpeechRecognition`) and real TTS (`speechSynthesis`), **with zero secret in our
app**, **no audio uploaded to our servers**, and no new backend dependency. No
Realtime/WebSocket — no premature complexity.

### Honest limitation — where the audio actually goes

`SpeechRecognition` is a **browser-native API**, but it is **not guaranteed to
process locally**. In Chrome / Chromium (desktop and Android) the recogniser
**streams the microphone audio to the browser vendor's cloud speech service
(Google)**; this is why it needs a network connection and fails offline with a
`network` error, and why headless Chromium — which ships without the vendor
speech key — cannot transcribe. We do **not** control or see that traffic, it is
**not** subject to our page CSP `connect-src`, and it is **not** our provider
(no secret, no billing on our side) — but it is dishonest to call the audio
"local" or "never leaving the device". Classification:

- `SpeechRecognition` (Chrome/Android): **BROWSER_NATIVE_API**, **REMOTE_VENDOR_PROCESSING_POSSIBLE** (Google) — LOCAL_PROCESSING is **UNKNOWN/NOT_CONFIRMED**.
- `speechSynthesis` (TTS): **BROWSER_NATIVE_API**; typically local but the voice set is vendor/OS-dependent — LOCAL_PROCESSING **UNKNOWN** per platform.

What **is** guaranteed: no audio reaches **our** backend, and **our** app holds
no provider secret. Teams handling audio under a strict data-residency
requirement should prefer the documented server-provider evolution below (a
provider we control, with a contractual data path) rather than the browser
vendor's speech service.

## Audit (pre-build classification)

| Asset | Class | Decision |
|-------|-------|----------|
| Web Speech `SpeechRecognition` / `speechSynthesis` | VERIFIED_EXISTING | **used** (real STT + TTS) |
| `conversationId` multi-turn store, orchestrator, gateway, SW15, tenant | VERIFIED_EXISTING | **reused verbatim** |
| OpenAI transcription / TTS / Realtime, Vercel AI Gateway | MISSING | not used (no secret; constraint forbids) |
| Server-side transcription route, MediaRecorder upload | NOT_REQUIRED | avoided (would need a provider secret) |
| CSP `Permissions-Policy: microphone=()` | PARTIAL | changed to `microphone=(self)` |
| iOS Safari `SpeechRecognition` | PARTIAL / UNRELIABLE | capability-detected at runtime; when absent/blocked → clean text fallback |
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

- **No client secret** — nothing provider-bearing reaches the browser, and **no
  audio is uploaded to our backend**. (The browser's own `SpeechRecognition` may
  still stream audio to the browser vendor's speech service — see the honest
  limitation above; that path is outside our app and carries no secret of ours.)
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

## Maturity classification (no over-claiming)

`FULL_VOICE_E2E` is **not** claimed as PASS_REAL. Each leg is graded honestly:

| Leg | Status | Basis |
|-----|--------|-------|
| `MIC_CAPTURE_REAL_DEVICE` | **DEVICE_VALIDATION_REQUIRED** | needs a physical mic on a real device; not runnable in this harness |
| `STT_REAL_DEVICE` | **DEVICE_VALIDATION_REQUIRED** | Web Speech recognition needs a real vendor-enabled browser + audio |
| `TRANSCRIPT_TO_HERMES_E2E` | **PASS_REAL** | verified against the live backend (below) — the path from a recognised transcript onward is real |
| `TTS_REAL_DEVICE` | **DEVICE_VALIDATION_REQUIRED** | `speechSynthesis` audible output needs a real device with voices |
| `FULL_VOICE_E2E` | **PARTIAL_REAL / DEVICE_VALIDATION_REQUIRED** | the mic→STT and TTS legs are unverified in-harness |

### What IS verified (real)

- **Pure logic** (`lib/voice/speech.ts`): real unit tests, `npm test`
  (Node `--test`, type-stripped). Secret-stripping, capability detection / iOS
  fallback, transcript normalisation, error mapping.
- **`TRANSCRIPT_TO_HERMES_E2E`** (real backend, impersonated via SQL): a
  transcript reaches a real `ANSWER_ONLY` (capability list), a real
  `ACTION → QUEUED` (diagnostic) and a sensitive `ACTION → QUEUED`
  (`btp.qualification.create`, approval-gated — not executed synchronously);
  unauthenticated → `UNAUTHENTICATED`; "ignore SW15" → `ANSWER_ONLY`, no bypass.
  All checks ran in rolled-back transactions — **zero fixtures persisted**.

### What is NOT verified in-harness (device validation required)

Live mic capture and the browser speech engine cannot be driven in headless
Chromium (which ships without the vendor speech key) or without real audio, and
`speechSynthesis` produces no assertable audio here. The `*_REAL_DEVICE` legs
must be validated on **Chrome desktop, Chrome Android, and iPhone/iPad Safari**
before treating voice capture/output as production-proven. **No microphone test
is fabricated.**

### Per-device expectation (to confirm on-device)

| Target | STT (`SpeechRecognition`) | TTS (`speechSynthesis`) |
|--------|---------------------------|--------------------------|
| Chrome desktop | Supported (webkit-prefixed); **remote vendor processing** | Supported |
| Chrome Android / Android tablet | Supported; remote vendor processing | Supported |
| Samsung Internet | Varies — capability-detected | Usually supported |
| iPhone / iPad Safari | **Unreliable / version-dependent** — often absent → text fallback | Supported |

Every "unsupported / blocked" case falls back to text (capability detection), so
the product still works — just without voice input on that device.

## Fallback & the documented next evolution

- **A. Compatible browser** → Web Speech input available.
- **B. Incompatible / blocked** (e.g. iPhone Safari) → the mode is disabled and
  **text stays fully usable**.

If device-independent, data-path-controlled STT is later required, the minimal
secure evolution is: **`MediaRecorder` capture → a server route → a provider we
control → the SAME `submitHermesMessageAction` pipeline.** It is **not**
implemented here because the app currently holds **no provider secret** and no
such secure server infra exists yet; adding one is a deliberate, separate change
(provider key in server env only, audio size/duration caps, no retention). Until
then, browser Web Speech + text fallback is the honest V1.

## Observability / cost

V1 STT/TTS run in the browser with no round-trip to **our** backend and no
provider billing on our side, so there is no telemetry/cost sink of ours to read.
Audio duration / provider / latency / STT-TTS success are therefore
**UNAVAILABLE** in V1 (not instrumented) — reported honestly, never fabricated.
The documented server-provider evolution above is what would feed the
mission-critical observability layer.
