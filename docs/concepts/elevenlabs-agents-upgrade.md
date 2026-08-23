# ElevenLabs Agents — upgrade survey and plan (concept)

Status: **T1 + T2 shipped and deployed (2026-08-20/21); T3–T5 remain concept** — researched 2026-08-20 against the live vendor surface
(npm registry, `elevenlabs/packages` GitHub releases, the ElevenLabs docs
changelog for 2026-06-15 / 08-03 / 08-17). T1 and T2 have since been built; T3–T5
are still proposals. The feature doc they change is
[`docs/features/interviews/README.md`](../features/interviews/README.md); the
transport principle it interacts with is
[`docs/architecture/voice-conversation-plane.md`](../architecture/voice-conversation-plane.md).

## 0. What "v3" actually is (the research answer first)

There is **no "ElevenLabs Agents v3"**. Three separate things carry a version
number and get conflated in the coverage:

| The thing called "v3" | What it really is | When it shipped |
| --- | --- | --- |
| **Eleven v3** | The expressive TTS *model*. GA. | GA 2026-02-02 |
| **Eleven v3 Conversational** (`eleven_v3_conversational`) | The low-latency dialogue variant of that model, selectable as an **agent's TTS model**; selecting it turns on **Expressive Mode** (context-aware tone, `[laughs]`/`[sighs]` tags, 70+ languages, prosody-aware turn-taking on Scribe v2 Realtime). ~280 ms model latency, same $0.08+/min agent price. | announced 2026-02-10 |
| **ElevenAgents React SDK v1.0** | The SDK API rewrite: `ConversationProvider` + granular hooks, unified React / React Native. We are **already on that line** (`@elevenlabs/react` 1.6.4). | 2026-03-27 |

What actually landed **in the last seven days** (2026-08-14 → 08-19) is a run of
minor SDK releases and one platform release — and one of those minors closes a
gap this repo has carried in writing since the July sweep:

- `@elevenlabs/client` 1.18.0 → **1.21.0**, `@elevenlabs/react` 1.12.1 → **1.13.0**
  (2026-08-19). New: **`overrides.asr.keywords` per session**, `webRtc.iceTransportPolicy`,
  `workletPaths` on the WebRTC path (strict-CSP self-hosted worklets),
  `onContextUsage`, experimental `rich_content`, and a set of
  disconnect-consistency fixes.
- Platform (2026-08-17): lightweight conversation summaries, concurrency wait
  queues, `merge_with_default_ignore_terms` for interruption terms, soft-timeout
  `disable_until_first_user_message`, new agent LLM options. Reported but
  unverified: the default agent ASR provider moved from `elevenlabs` to
  `scribe_realtime` — confirm against the live agent before assuming it.

**Verdict: the upgrade is feasible and cheap**, and its value is not the word
"v3" — it is (a) per-session ASR keywords, which fixes a known scoring-fairness
defect, and (b) the v3-conversational model, which is a product judgment call,
not a technical one.

## 1. Where we use ElevenLabs today

| Layer | File | What it does |
| --- | --- | --- |
| Credential mint | `app/_lib/voice/elevenlabs.ts` | `GET /v1/convai/conversation/get-signed-url` → `{ provider, signedUrl }` |
| Host resolution | `app/_lib/voice/self-hosted.ts` | `ELEVENLABS_BASE_URL` points the same protocol at a self-run service |
| Route | `app/api/interview/connect/route.ts` | lifecycle guards → rate limit → mint → candidate-safe brief |
| Browser transport | `app/_components/voice/transport/elevenlabs.ts` | `useConversation` + `startSession({ signedUrl, connectionType: "websocket", overrides })` |
| Agent config | `scripts/setup-eleven-agent.mjs` + `app/_lib/voice/eleven-agent-diff.mjs` | deploys and drift-checks the hosted agent (`eleven_flash_v2_5`, `gemini-2.5-flash`, static `asr.keywords`, override flags) |
| Cost attribution | `app/_lib/voice/minute-prices.ts` | $0.09/min estimate, agent id as the model identity |

Installed: `@elevenlabs/react` **1.13.0** / `@elevenlabs/client` **1.21.0** as of
T1 below (it was 1.6.4 / 1.9.0 when this was written — a lockfile bump inside the
same major, not a package change).

## 2. Upgrade tracks

### T1 — SDK 1.6.4 → 1.13.0 — **DONE (2026-08-20)**

All releases between are minor/patch inside the v1 line; `ConversationProvider`
and the granular hooks already exist in 1.6.4, so our direct `useConversation`
call keeps working. Worth having for its own sake: **1.12.1 fixes conversation
state through disconnect** — `onDisconnect` now always fires even when teardown
throws, and `useConversationStatus` reports `disconnected` as teardown starts.
Our `finalize-status.ts` verdict (`completed` vs `failed`) is driven off exactly
that ordering, so this is a correctness win for the ledger, not just hygiene.

- Touch: `package.json` / `package-lock.json`.
- Verify: `npm run typecheck`, `npm run test:unit`, then the keyless e2e subset.

### T2 — Per-session ASR keywords — **DONE (code 2026-08-20, deployed 2026-08-21)**

`docs/features/interviews/README.md` records the gap verbatim: the recognizer
corrupts technology names ("React" → "Rust", "PostgreSQL" → "později SQL"), the
scorecard then rates a fabricated skill set, and the only available fix was a
**static account-level** keyword list requiring an agent redeploy — "per-session
keywords aren't reachable through the browser SDK (its override type has no
`asr` field)".

As of `@elevenlabs/client` 1.21.0 that field exists:

```ts
overrides: { asr: { keywords: string[] } }   // max 50 per conversation
```

Shape of the change:

1. Server derives the keyword list **per interview** from the job's tech stack
   (JD skills + the entry's CV-extracted technologies), truncated to 50, and
   returns it beside `agentPrompt` from `/api/interview/connect` — same
   candidate-safe path the prompt already travels, and no new secret on the wire
   (these are public job terms).
2. `startElevenLabsSession` passes it through as `overrides.asr.keywords`.
3. `scripts/setup-eleven-agent.mjs`: add `asr: true` to `OVERRIDE_INTENT` (the
   agent must *allow* the override) and to the `eleven-agent-diff.mjs` field
   table so `--check` keeps catching drift. The static `ASR_KEYWORDS` list stays
   as the floor for lab sessions with no job context.
4. Deploy step: overrides are enabled at agent creation, so this needs a
   `--deploy` (agent-id rotation) — the script's header documents that ritual.

**What shipped:** `app/_lib/voice/asr-keywords.mjs` (the floor list + the
per-conversation builder, shared with the deploy script),
`interviewAsrKeywords` in `app/_lib/interview-run.ts`, `asrKeywords` on the
`/api/interview/connect` response, `overrides.asr.keywords` in the browser
transport, and `asr_keywords` in `OVERRIDE_INTENT` + the drift diff.
**Deployed 2026-08-21.** `--check` reports zero drift against the new agent. The
deploy was blocked until then by something worth recording: `runDeploy` read
`.env.local` exclusively, and this checkout keeps its keys in `.env` — the script
exited "not found" while the app around it ran fine on credentials it refused to
read. It now resolves `.env.local` → `.env` and writes the rotated id back to
whichever file supplied the key. The drift report also caught two live defects
that had nothing to do with keywords: `max_duration_seconds` 600 against an
intended 2400, and a 717-char prompt against the intended 2336. Candidate
CV-extracted technologies are still not read; job terms only.

Why it matters beyond accuracy: a corrupted transcript feeds the scorecard,
which feeds an Interview→Offer gate. This is the fairness-relevant defect of the
three, and `docs/features/compliance/ai-act-conformity.md` is downstream of it.

### T3 — `eleven_v3_conversational` + Expressive Mode (M, product decision)

Purely an agent-config change — `ELEVENLABS_TTS_MODEL` already exists as the
env-resolved field in `intendedConfig()`, so the mechanical cost is one env var
plus a `--deploy`. The judgment is the hard part:

**For.** 70+ languages vs Flash's 32 — we ship `en`/`cs`/`de`/`fr` and the
harness has repeatedly caught language drift and flat delivery in Czech.
Context-aware turn-taking (prosody, not just transcript) means fewer
interruptions of a nervous candidate — the exact failure our one-question-per-turn
persona was written to avoid. Same per-minute price.

**Against.** ~280 ms vs ~75 ms model latency (network-inclusive the delta is
smaller, but it is real). Expressive delivery is *evaluative-sounding*: our
persona forbids praise and approval on purpose, and an interviewer that laughs or
warms its tone at a good answer leaks a signal to the candidate and gives the
same answer a different reception depending on delivery. Expressive tags are also
LLM-emitted, i.e. not under our review. Expressive mode does not preserve
Professional Voice Clone characteristics.

**Therefore:** do not flip it globally. `model_id` is **not** per-session
overridable (only `voice_id`, `speed`, `stability`, `similarity_boost` are), so
an honest comparison means **two agents** — `ELEVENLABS_AGENT_ID` and a new
`ELEVENLABS_AGENT_ID_EXPRESSIVE` — chosen per session, and run through the
existing voice harness (`pipeline/jobfit/eval/voice/`) on the same candidate
scripts, scoring language-lock (`app/_lib/voice/language-lock.ts`), interruption
count, and whether evaluative neutrality holds in the transcript. Ship it only if
the harness says it wins. Add a prompt clause forbidding audio tags if we keep it.

### T4 — WebRTC transport (M/L, do after T2–T3)

The vendor's stated reason for WebRTC is echo cancellation and background-noise
removal — i.e. it attacks the same corrupted-transcript class as T2, upstream of
the recognizer. Costs:

- WebRTC needs a **`conversationToken`** (`GET /v1/convai/conversation/token`),
  not a signed URL — a second mint path in `ElevenLabsVoiceAdapter`, a widened
  `ElevenLabsConnect` type, and a `connect-response-contract.test.ts` update.
- `app/_lib/voice/preflight.ts` currently asserts that only the OpenAI path needs
  `RTCPeerConnection` (pinned by `preflight.test.ts`). Moving ElevenLabs to
  WebRTC makes that assertion false and removes today's "works where WebRTC is
  blocked" fallback — a real property in corporate/VDI networks.
- **Self-hosted mode must stay WebSocket**: `ELEVENLABS_BASE_URL` services speak
  the signed-URL protocol; `isSelfHostedVoice()` already exists to branch on.

So: env-flagged (`ELEVENLABS_TRANSPORT=webrtc|websocket`, default websocket),
WebSocket kept as the automatic fallback through the existing
`connect-failover.ts` machinery, and `webRtc.iceTransportPolicy: "relay"` exposed
for networks that drop direct UDP.

### T5 — Observability and CSP (S, opportunistic)

- `onContextUsage` reports `{ context_tokens, context_limit_tokens }` per turn.
  Our long screens have no signal for approaching the LLM context limit today; a
  cheap warning plus a telemetry field beats discovering it as a truncated
  interview.
- `workletPaths` now applies on the WebRTC path — relevant only if T4 lands and
  we tighten CSP (`blob:`/`data:` in `script-src`).
- Skip `rich_content` — experimental, and the server only offers components to
  the embedded widget, which we do not use.

## 3. Sequence

1. ~~**T1** lockfile bump + gate.~~ Done — `@elevenlabs/react` 1.13.0 / client 1.21.0.
2. ~~**T2** per-session ASR keywords (server derivation → SDK override → agent
   override flag → `--deploy`).~~ Done and live; a harness run on the corruption
   fixtures is still owed.
3. **T3** expressive A/B behind a second agent id; ship on harness evidence only.
4. **T4** WebRTC behind an env flag, WebSocket default, self-hosted excluded.
5. **T5** fold in with whichever of T2/T4 touches the transport file.

Verification gate for each step (unchanged from `AGENTS.md`): `npm run typecheck`
· `test:unit` · `lint` · `design:check` · `i18n:check` · the keyless e2e subset,
plus `node scripts/setup-eleven-agent.mjs --check` after any agent deploy, plus
the voice harness for T2/T3.

## 4. What this does not change

The vendor stays a **transport with a hosted brain** for the candidate interview;
`voice-conversation-plane.md`'s relay design (ours-is-the-brain) is the separate,
larger migration, and none of T1–T5 blocks or advances it. Keyless behavior is
untouched: no key → the provider is simply unavailable, as today.
