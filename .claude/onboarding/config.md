---
app: "KP (CandiDate)"
env_file: .env.local
env_example: .env.example
boot: "npm run dev"
boot_success: "GET /api/health -> 200"
docs: "docs/concepts/local-first-edge.md (section 8 is the install design rationale)"
---

# KP onboarding overlay

Project specifics for the registry `onboarding` skill. Commands here come from
`package.json`, `requirements.txt` and `.env.example` — if one is gone from the
repo, trust the repo.

## Install modes

| mode | consequences |
| --- | --- |
| Developer laptop (just me) | open dev mode is fine; `KP_OPERATOR_PASSWORD` optional; `KP_SECRET` recommended (needed the moment a key is saved in Settings -> Models) |
| Self-host for a team | `KP_OPERATOR_PASSWORD` and `KP_SECRET` REQUIRED (production fails closed without the password unless `KP_ALLOW_OPEN=1`); `KP_DB_PATH` must be an ABSOLUTE path; set `NEXT_PUBLIC_APP_BASE_URL` to the public origin candidates will see; point them at docs/architecture/self-hosting.md for Docker; still run the local flow so the env file ends up right |
| Just evaluating | fastest path: skip every key group, boot keyless, show the demo corpus; print the matrix so they know what keys would unlock |

## Runtime prerequisites

| tool | min version | probe command | required or optional | fix hint |
| --- | --- | --- | --- | --- |
| node | >= 20 (Docker image runs 24) | `node --version` | required | install Node 20+ |
| python | >= 3.11 | `python --version` (honor `PYTHON_CMD`) | required | install Python 3.11+; the app spawns it for the jobfit pipeline |
| python deps | — | `python -c "import pipeline.jobfit.codegen"` | required | `pip install -r requirements.txt` when the import fails |
| git | any | `git --version` | required | — |
| npm deps | — | `node_modules/` present | required | `npm install` when absent |
| schemas codegen | — | `npm run schemas:gen` | required | proves the Python side end to end — `npm run typecheck` depends on it |
| Claude Code CLI | any | `claude --version`, then logged-in smoke `claude -p "say ok" --output-format json` (short timeout) | optional | present + logged in = default LLM engine on subscription billing, no key to collect; absent is NOT a failure — deterministic fallbacks run instead, say so |
| docker | any | `docker --version` | conditional: self-host mode | — |
| wrangler | any | `npx wrangler --version` | conditional: edge | — |
| local model server | — | `curl http://localhost:11434/v1/models` | conditional: llm-engine (local server option) | Ollama / LM Studio / vLLM on :11434 or wherever `OPENAI_BASE_URL` points |

## Capability groups

### llm-engine

- **unlocks**: LLM judgment across the app — automation tasks, devcase design/evaluate, match reasoning, scorecards, campaign packs.
- **keys**: `OPENAI_BASE_URL` (local server), or a provider key via Settings -> Models (Gemini / OpenAI / Anthropic / Azure / OpenRouter / Qwen; UI-entered keys are encrypted under `KP_SECRET`).
- **options**:
  - Claude CLI (Recommended if the runtime probe found it logged in): subscription billing, default engine, nothing to set.
  - Local server (Ollama / LM Studio / vLLM): free, private; set `OPENAI_BASE_URL` (e.g. `http://localhost:11434/v1`) or add it in Settings -> Models; a local 8B is fine for single-decision work, weaker on scorecards/campaign packs (see README benchmark).
  - Provider API key: paste in Settings -> Models (encrypted under `KP_SECRET`) or env.
  - None: every LLM feature degrades to its deterministic fallback; the app runs without complaint.
- **verify**: the Claude CLI smoke from the prerequisites table, or `curl <OPENAI_BASE_URL>/models` for a local server. Read-only.
- **without**: `fallback:` every LLM feature runs its deterministic implementation — rule-based output instead of LLM judgment, no errors.

### gemini

- **unlocks**: the flagship CV-analysis pipeline (Analyze/Match tabs, CLI scripts, eval harness), salary grounding, and the GitHub repo-signal review.
- **keys**: `GEMINI_API_KEY` (`GOOGLE_API_KEY` is honored as an alias).
- **options**: paste the key / later.
- **verify**: the variable is now present in the env file; do not place a live call.
- **without**: `hard-required:` CV analysis fails loudly (this one does NOT degrade silently) and github-analysis returns an error status. The variable that lifts it is `GEMINI_API_KEY`.

### voice

Live *conversation* provider for AI voice interviews — one of KP's two voice
planes (docs/architecture/voice-tts-package.md). Ask it as "Voice interviews".

- **unlocks**: candidate voice-interview sessions at /interview/[token] and the /interview-lab bench.
- **keys**: `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_REALTIME_MODEL`, `KP_VOICE_PROVIDER`.
- **options**:
  - ElevenLabs: collect `ELEVENLABS_API_KEY`, then offer the `scripts/setup-eleven-agent.mjs` helper (below) which creates the agent and writes `ELEVENLABS_AGENT_ID` back into the env file itself. Write `KP_VOICE_PROVIDER=elevenlabs` so the default honors the choice.
  - OpenAI Realtime: `OPENAI_API_KEY` (+ `OPENAI_REALTIME_MODEL` default is fine). Write `KP_VOICE_PROVIDER=openai`.
  - Self-hosted (Gravitone): `ELEVENLABS_BASE_URL=http://127.0.0.1:8080`, `ELEVENLABS_AGENT_ID=local-interviewer`, `ELEVENLABS_API_KEY=local` — free; loopback sessions bypass the billing meter. `KP_VOICE_PROVIDER=elevenlabs`.
  - Off: designed keyless behavior — see without.
- **verify**: confirm `ELEVENLABS_AGENT_ID` is now set (the helper writes it); do not place a live call.
- **without**: `hidden:` voice features hide themselves rather than erroring — candidates never see a broken door. This is the designed keyless behavior.
- **helper**: `scripts/setup-eleven-agent.mjs` (see Setup helpers).

### tts

Spoken output — the second voice plane, behind the portable `packages/voice-tts`
package and `/api/tts`. Ask it as "where should synthesized speech come from?"
and let the install mode shape the recommendation: developer laptop -> offer
BOTH a local engine and the cloud so the compare panel at /interview-lab can be
used to judge quality by ear; team self-host -> pick one and lock it.

- **unlocks**: synthesized speech from `/api/tts` and the /interview-lab compare panel.
- **keys**: `KP_TTS_PROVIDER`, `KP_TTS_PROVIDERS`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `KOKORO_BIN`, `KOKORO_MODEL_DIR`, `PIPER_BIN`, `PIPER_VOICE_DIR`, `VOICE_SIDECAR_HOME`.
- **options**:
  - ElevenLabs (cloud): reuses `ELEVENLABS_API_KEY` from the voice group (or collect it now); optional `ELEVENLABS_VOICE_ID`. Costs per character.
  - Kokoro (local, ENGLISH ONLY, best local quality): the sherpa-onnx sidecar + ~310 MB model. PROBE FIRST: `ls ~/.personas/companion-tts/bin` and `.../kokoro/model.onnx` — if the Personas desktop app is installed on this machine the engine is already there and nothing needs downloading (one install serves every app). If absent, help install: either open Personas -> Companion -> Voice -> Install (one click, Windows), or point `KOKORO_BIN` at a sherpa-onnx-offline-tts binary and `KOKORO_MODEL_DIR` at an extracted kokoro-multi-lang-v1_0 folder (model.onnx, voices.bin, tokens.txt, espeak-ng-data). Private: audio never leaves the machine. SAY THE LIMIT OUT LOUD: Kokoro here speaks English only (one curated voice, af_heart). A user who needs Czech spoken output gets it from Piper or ElevenLabs; a Czech sentence sent to Kokoro comes back in an English accent, not an error — so the matrix row must name the language.
  - Piper (local, Czech-capable): `pip install piper-tts` then `python -m piper.download_voices --download-dir data/piper en_US-lessac-medium cs_CZ-jirka-medium` (~63 MB each). Lower voice quality than Kokoro, but the only local Czech voice. Private.
  - None: see without.
  - Whatever was chosen: write `KP_TTS_PROVIDER=<preferred id>` and, when more than one was set up, `KP_TTS_PROVIDERS=<comma list>` (unset means "offer everything registered"; a single id locks the compare panel to one provider for a team deploy).
- **verify**: `curl -s localhost:<port>/api/tts` (GET probes only — spends nothing) and read each provider's `probe.state` — absent / broken / ready are three different facts; a `broken` means installed-but-failing (truncated download, wrong folder) and the reason names what to fix.
- **without**: `fallback:` `/api/tts` answers 503 with a typed `unavailable` and the lab panel shows every provider as "not installed" with its setup hint; nothing else in the app depends on it.

### github-signal

- **unlocks**: higher rate limits for the GitHub repo deep-dive analysis.
- **keys**: `GITHUB_TOKEN`.
- **options**: paste a token / later. Rides along wherever the user mentions the GitHub deep dive — never required.
- **verify**: the variable is now present; do not spend an API call.
- **without**: `fallback:` analysis runs on the anonymous limit (60/hr) and degrades to rate-limit messaging when exhausted.

### kp-secret

- **unlocks**: encrypting UI-entered provider keys at rest (AES-256-GCM, `/api/llm/keys`); also the encryption key for stored calendar/ATS credentials (via `KP_ATS_SECRET_KEY` falling back to `KP_SECRET`).
- **keys**: `KP_SECRET`.
- **options**: offer to GENERATE it (shape in Env notes) / paste one / later.
- **verify**: the variable is now present.
- **without**: `fallback:` env-var-configured providers still work, but saving a key in Settings -> Models is refused until `KP_SECRET` exists, and KP refuses to store a Google Calendar refresh token rather than persisting a credential in clear.

### operator-auth

- **unlocks**: password-gated operator routes (the fail-closed auth proxy).
- **keys**: `KP_OPERATOR_PASSWORD`; optionally `KP_DECISION_HMAC_KEY` + `KP_DECISION_HMAC_KEY_ID` for tamper-RESISTANT decision chains — read the `.env.example` block aloud in one sentence: it cannot retro-seal old records; rotate, never remove.
- **options**: set a strong password (REQUIRED for team mode) / dev-open (laptop mode only).
- **verify**: with the password set, an operator route answers 401 without a session; keyless dev mode answers 200.
- **without**: `hard-required:` in production the app fails closed — it refuses to serve open unless `KP_ALLOW_OPEN=1` is set deliberately. (On a developer laptop, unset = open dev mode, which is the recommended default there.)

### edge

- **unlocks**: an always-on Cloudflare Worker that holds inbound webhooks, candidate email and delivery receipts while this install is switched off, and drains them in order when it wakes (docs/concepts/local-first-edge.md, edge/README.md).
- **keys**: `KP_EDGE_URL`, `KP_EDGE_SECRET` (the SAME value set on the Worker with `wrangler secret put KP_EDGE_SECRET` — no secret, no drain), optional `KP_NUDGE_TARGET` (any POST endpoint, e.g. a free ntfy.sh topic; the nudge carries COUNTS, never names).
- **options**: deploy the worker to YOUR OWN account (fits the free plan; needs wrangler — conditional prerequisite) / later.
- **verify**: `/api/comms/capability` reflects the pairing; the Channels tab stops saying "Not paired".
- **without**: `fallback:` UNSET is a complete, honest state — inbound events reach this install only while it runs, which is what a local-first app is; the Channels tab says "Not paired". `KP_OFFLINE=1` disables the edge entirely.

### billing

Only surface this group in self-host-for-a-team mode, and even then say: ONLY
for running KP *as a paid service*.

- **unlocks**: metered billing via Polar (docs/features/billing/README.md).
- **keys**: `POLAR_ACCESS_TOKEN`, `POLAR_SERVER` (sandbox until the billing checklist passes), `POLAR_WEBHOOK_SECRET`, `POLAR_PRODUCT_STARTER`, `POLAR_PRODUCT_GROWTH`, `POLAR_PRODUCT_MINUTE_PACK` (`POLAR_PRODUCT_BYOM` only for existing subscribers — withdrawn from sale).
- **options**: configure Polar / leave empty (the normal self-host).
- **verify**: the variables are present; do not call Polar.
- **without**: `fallback:` with no billing provider configured (and no billing history) NOTHING is metered — every allowance resolves unlimited and no gate ever fires (`app/_lib/billing/mode.ts`). Setting `POLAR_ACCESS_TOKEN` is what turns metering ON.

### comms

- **unlocks**: actually SENDING candidate email (acknowledgements, invites, offers) through an outbound relay, plus asynchronous delivery receipts and inbound email intake.
- **keys**: `COMMS_WEBHOOK_URL` (+ `COMMS_CALLBACK_SECRET` for bounce/complaint/drop receipts on `/api/comms/callback` — unset means that callback answers 503, fail-closed), `EMAIL_INBOUND_DOMAIN` (only when a real inbound-mail provider routes `<token>@<domain>` to the receiver).
- **options**: relay URL via env or the RelayConfigCard on the Channels tab / the edge flow (when `edge/` exists in the repo — check before offering) / none.
- **verify**: `GET /api/comms/capability` — the relay bit matches what was configured.
- **without**: `fallback:` every message is recorded terminal `queued` in the local outbox and the UI says honestly that nothing is being sent; the Email intake wizard shows the HTTP receiver URL and says forwarding isn't wired instead of fabricating a mailbox.

### calendar

- **unlocks**: Google Calendar two-way scheduling — free/busy reads so no slot is offered that the interviewer already has booked, and event writeback for confirmed interviews. Scopes are deliberately the two narrow ones (calendar.freebusy + calendar.events).
- **keys**: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`. Register the EXACT redirect URI `<app origin>/api/calendar/google/callback`; `GET /api/calendar/google` echoes the exact string for this deployment. Token storage requires `KP_ATS_SECRET_KEY` or `KP_SECRET` (see kp-secret).
- **options**: create the OAuth client and paste both / later.
- **verify**: `GET /api/calendar/google` answers with the connect state.
- **without**: `fallback:` scheduling still works link-based with kp-side collision checks only — exactly as before the feature existed.

### observability

- **unlocks**: LLM call tracing (LightTrack) and error reporting (Sentry).
- **keys**: `LIGHTTRACK_URL` + `LIGHTTRACK_PROJECT` (local LLM observability; monitoring activates ONLY when the URL is set), `SENTRY_DSN` (server), `NEXT_PUBLIC_SENTRY_DSN` (browser — build-time inlined).
- **options**: LightTrack (local, `pwsh scripts/lighttrack-dev.ps1` starts a dev server on 127.0.0.1:8787) / Sentry / both / none.
- **verify**: the variables are present; LightTrack's `/` answers on its port if it was started.
- **without**: `fallback:` zero observability egress — the default, and `KP_OFFLINE=1` skips Sentry even when a DSN is set.

## Zero-key path

- The app boots and the whole workspace works: pipeline board, JD library,
  candidate management, simulation — a fresh DB **self-seeds the demo corpus**
  from `data/seed_*`, so the empty app is worth looking at immediately.
- Every LLM feature degrades to its deterministic implementation instead of
  crashing — a product property, not a failure. (Exception: CV analysis is
  hard-required on `GEMINI_API_KEY` and fails loudly.)
- Voice hides itself; TTS answers a typed 503; comms records `queued` honestly;
  scheduling runs link-based.
- `KP_OFFLINE=1` is the hard no-egress guard for air-gapped evaluation: KP
  refuses every outbound call except loopback + explicitly configured private
  endpoints (`KP_OFFLINE_ALLOW_HOSTS` widens it deliberately).

## Setup helpers

| script | what it does | when to offer |
| --- | --- | --- |
| `node scripts/setup-eleven-agent.mjs` | creates the ElevenLabs Conversational AI agent from the API (multilingual, Czech-capable) and writes `ELEVENLABS_AGENT_ID` back into the env file itself — whichever of `.env.local`/`.env` supplied the key is the file it writes; re-running creates a new agent, newest id wins (`--check` diffs live vs intent, `--deploy` publishes) | voice group, ElevenLabs option, after `ELEVENLABS_API_KEY` is set |
| `pwsh scripts/lighttrack-dev.ps1` | starts the local LightTrack server (dev auth mode, SQLite, 127.0.0.1:8787) | observability group, LightTrack option (one-time wiring: `pip install -e ../LightTrack/clients/python`) |
| `npm run dev:empty` | second, isolated empty-DB dev server (throwaway `data/kp-empty.sqlite`, port 3002) to preview the newcomer experience without touching the seeded DB | when the user wants to see the true blank-tenant first-run |

## Boot verify

1. Pre-boot gate: `npm run typecheck` — it runs `schemas:gen` first, so one
   command proves both languages.
2. Boot: `npm run dev` in the background. **Port discipline: dev-guard allows
   ONE dev server per checkout** (the lock is `.next/dev/lock`) and prints an
   "already running" banner with the live port when one exists — READ the
   banner, do not assume :3000.
3. Probe against the live port: `GET /api/health` (200), `GET
   /api/comms/capability` (relay bit matches what was configured), the landing
   page `/` (200).
4. Per-group probes as declared above; notably: if voice was configured,
   confirm `ELEVENLABS_AGENT_ID` is now set (the helper writes it) — do not
   place a live call; for TTS, `GET /api/tts` and confirm the chosen
   `KP_TTS_PROVIDER` reports `ready`.
5. Restart note: env changes require a dev-server restart; a server already
   running before the env write is the classic false "it works".

## Env notes

- `NEXT_PUBLIC_*` variables are inlined at BUILD time; a runtime-only value
  cannot reach an already-built client bundle.
- **`KP_DB_PATH` must be an ABSOLUTE path in any real deploy** — the default is
  derived from the launch directory, and a cron/service launched from elsewhere
  silently opens a DIFFERENT, empty DB (`.env.example` says so; the Docker
  image sets `/data/kp.sqlite`).
- **`KP_SECRET` is worth generating for the user**: any long random string;
  `openssl rand -hex 32` shape (32 bytes of hex). Generated locally, written
  directly, never echoed.
- `KP_DECISION_HMAC_KEY` (+ `KP_DECISION_HMAC_KEY_ID`) has the same generated
  shape, but its own lifecycle: it cannot retro-seal records written before it;
  ROTATE, NEVER REMOVE (keep retired secrets readable as
  `KP_DECISION_HMAC_KEY_<oldId>`). Deliberately NOT `KP_SECRET` — an audit
  chain must survive an auth-secret rotation.
- `GOOGLE_API_KEY` is an accepted alias for `GEMINI_API_KEY`.
- Team mode also sets `NEXT_PUBLIC_APP_BASE_URL` to the public origin
  candidates will see (build-time caveat above applies).
- `ANTHROPIC_API_KEY` is deliberately NOT part of setup: the Claude CLI engine
  runs on the interactive subscription login and the spawner strips API-key
  vars from the child environment.

## Matrix rows

Make the table match what the UI will say — the Getting-started card and the
Channels banner derive from the same server facts, and this table must not
out-promise them.

| feature | states it can be in | what decides | how to change |
| --- | --- | --- | --- |
| Workspace, pipeline, JD library, simulation | on | needs nothing | — |
| LLM features | on (claude-cli) / on (provider) / deterministic | llm-engine group | Settings -> Models |
| CV analysis | on / off | `GEMINI_API_KEY` | set it |
| Voice interviews | on / hidden | keys or self-hosted URL | `/onboarding voice` |
| Spoken output (TTS) | <provider> (+ languages: Kokoro en-only) / none | `KP_TTS_PROVIDER` + engine ready | `/onboarding tts` |
| Comms delivery | sending / queued-only (honest) | relay or edge | `/onboarding comms` |
| Calendar sync | on / link-based | Google OAuth | `/onboarding calendar` |
| Auth | open (dev) / password | mode choice | `KP_OPERATOR_PASSWORD` |

Close with: the demo corpus is already seeded (fresh DB self-seeds); the first
four Getting-started steps (company, first role, case, channels) are the
in-app continuation of this onboarding; and any group answered "later" can be
re-run alone with `/onboarding <group>`.

## Notes

Content from the local skill v0.2.0 with no dedicated slot in the overlay
contract, kept here rather than dropped:

- **Question batching**: v0.2.0 asked the groups in two batches — Batch A:
  llm-engine, gemini, voice (two questions: conversation + spoken output),
  comms; Batch B: calendar, observability, security baseline
  (operator-auth + kp-secret), billing. Keep roughly that order; the generic
  skill's max-4-per-batch rule covers the mechanics.
- **`KP_VOICE_PROVIDER`** is honored only when that provider is configured;
  otherwise the canonical order (OpenAI first) applies
  (`app/_lib/voice/index.ts`, `onboardedVoiceProvider`).
- v0.2.0's portability note (move the group table into a per-repo manifest) is
  realized by this very file — the registry skill + this overlay supersede the
  local skill.
