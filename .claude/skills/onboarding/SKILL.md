---
name: onboarding
description: "Take a fresh KP clone to a running, honestly-labelled install in one conversation: probe runtime deps, ask which connector capabilities the operator wants, collect keys into .env.local (or acknowledge per feature what stays limited without them), verify by booting the app, and hand back a capability matrix. Invoke with /onboarding (full run) or /onboarding <group> (one group, e.g. /onboarding voice)."
category: workflow
memory: none
version: 0.1.0
---

# Onboarding — resolve every dependency, honestly

The job: a newcomer cloned KP and wants it running. Walk them from clone to a
booted app whose capability story matches reality — every feature either ON,
or LIMITED with a stated reason and the exact var that lifts it. Design
rationale lives in `docs/concepts/local-first-edge.md` section 8.

Hard rules, before anything else:

- **Never invent a command.** Commands come from `package.json` scripts,
  `requirements.txt`, and `.env.example`. If a command this file names is gone,
  trust the repo, not this file, and say so.
- **Never echo a secret.** When the user pastes a key, write it to `.env.local`
  and refer to it only as `<set>`. Never store keys in memory files, never put
  them in a commit, never print them back.
- **`.env.local` is merged, not overwritten.** Preserve every existing line.
  Never change a var that already has a value without asking first.
- **"Not configured" is a real outcome.** The keyless/deterministic path is a
  product property here, not a failure. Offer it as a first-class option in
  every group, and label what it means for the feature.
- **Do not block on what the user can skip.** Any group can be answered
  "later" - record it in the final matrix with the exact vars to set.

## Step 0 - mode

One AskUserQuestion: "How will this install run?"

| option | consequences |
| --- | --- |
| Developer laptop (just me) | open dev mode is fine; KP_OPERATOR_PASSWORD optional; KP_SECRET recommended (needed the moment a key is saved in Settings -> Models) |
| Self-host for a team | KP_OPERATOR_PASSWORD and KP_SECRET REQUIRED (production fails closed without the password unless KP_ALLOW_OPEN=1); point them at docs/architecture/self-hosting.md for Docker; still run the local flow so .env is right |
| Just evaluating | fastest path: skip every key group, boot keyless, show the demo corpus; print the matrix so they know what keys would unlock |

## Step 1 - runtime probe

Probe, report as a table (ok / FAIL / not found + version), fix what is
fixable, name what is not. Do not skip the table even when all green.

1. `node --version` - need >= 20 (Docker image runs 24).
2. `python --version` (honor PYTHON_CMD) - need >= 3.11; then
   `pip install -r requirements.txt` if imports are missing
   (`python -c "import pipeline.jobfit.codegen"` is the cheap probe).
3. `git --version`.
4. `npm install` if `node_modules/` is absent.
5. `npm run schemas:gen` - proves the Python side end to end (typecheck
   depends on it).
6. Claude Code CLI: `claude --version`; if present, a logged-in smoke:
   `claude -p "say ok" --output-format json` with a short timeout. Present +
   logged in = the default LLM engine works on subscription billing with no
   key. Absent is NOT a failure - deterministic fallbacks run instead; say so.
7. Optional, only if the user later picks them: `docker --version`,
   `npx wrangler --version`, local model server on :11434
   (`curl http://localhost:11434/v1/models`).

## Step 2 - capability groups

Ask in batched AskUserQuestion calls (max 4 questions per call, so two
batches). Every option states what you GET and what stays LIMITED. The
"none" option is always present and never shamed.

Batch A:

1. **LLM engine** - header "LLM engine":
   - Claude CLI (Recommended if step 1 found it logged in): subscription
     billing, default engine, nothing to set.
   - Local server (Ollama / LM Studio / vLLM): free, private; set
     OPENAI_BASE_URL (e.g. http://localhost:11434/v1) or add it in
     Settings -> Models; a local 8B is fine for single-decision work, weaker
     on scorecards/campaign packs (see README benchmark).
   - Provider API key (Gemini / OpenAI / Anthropic / Azure / OpenRouter /
     Qwen): paste in Settings -> Models (encrypted under KP_SECRET) or env.
   - None: every LLM feature degrades to its deterministic fallback; the app
     runs without complaint.
2. **CV extraction and salary grounding** - GEMINI_API_KEY (GOOGLE_API_KEY is
   an alias). Without it: CV analysis fails loudly (this one does NOT degrade
   silently) and github-analysis errors. Options: paste key / later.
3. **Voice interviews** - the canonical "acknowledge the limit" group.
   Options:
   - ElevenLabs: ELEVENLABS_API_KEY now, then offer to run
     `node scripts/setup-eleven-agent.mjs` which creates the agent and writes
     ELEVENLABS_AGENT_ID back into .env.local itself.
   - OpenAI Realtime: OPENAI_API_KEY (+ OPENAI_REALTIME_MODEL default is fine).
   - Self-hosted (Gravitone): ELEVENLABS_BASE_URL=http://127.0.0.1:8080,
     ELEVENLABS_AGENT_ID=local-interviewer, ELEVENLABS_API_KEY=local - free,
     loopback sessions bypass the billing meter.
   - Off: voice features HIDE themselves rather than erroring - candidates
     never see a broken door. This is the designed keyless behavior.
4. **Comms delivery** - header "Comms":
   - Relay URL: COMMS_WEBHOOK_URL (+ COMMS_CALLBACK_SECRET for receipts) or
     the RelayConfigCard on the Channels tab.
   - Edge (when `edge/` exists in the repo - check before offering): the
     Cloudflare worker flow from docs/concepts/local-first-edge.md.
   - None: every message is recorded terminal `queued` in the local outbox and
     the UI says honestly that nothing is being sent.

Batch B:

5. **Calendar** - GOOGLE_OAUTH_CLIENT_ID/SECRET for free/busy + event
   writeback; without them scheduling still works link-based with kp-side
   collision checks only.
6. **Observability** - LIGHTTRACK_URL + LIGHTTRACK_PROJECT (local LLM
   observability) and/or SENTRY_DSN; none = zero egress, the default.
7. **Security baseline** - based on step 0: KP_OPERATOR_PASSWORD (required for
   team mode), KP_SECRET (offer to generate: any long random string;
   `openssl rand -hex 32` shape), optionally KP_DECISION_HMAC_KEY (+_ID) for
   tamper-resistant decision chains - read the .env.example block aloud in one
   sentence: it cannot retro-seal old records, rotate never remove.
8. **Billing (Polar)** - only surface in self-host-for-a-team mode, and even
   then say: ONLY for running KP as a paid service; a normal self-host leaves
   this empty and nothing is metered.

GITHUB_TOKEN rides along wherever the user mentions the GitHub deep dive -
optional, raises rate limits, never required.

## Step 3 - write .env.local

- If `.env.local` does not exist, start from the relevant lines of
  `.env.example` (keep its comments for the vars you set).
- Merge per the hard rules above. Generate KP_SECRET if the user asked.
- For team mode also set: KP_DB_PATH to an ABSOLUTE path (the default is
  launch-directory-derived and a cron/service from elsewhere silently opens a
  different empty DB - .env.example says so), NEXT_PUBLIC_APP_BASE_URL to the
  public origin candidates will see.
- Remind: NEXT_PUBLIC_* vars are inlined at BUILD time; a runtime-only value
  cannot reach an already-built client bundle.

## Step 4 - verify

1. `npm run typecheck` (runs schemas:gen first - proves both languages).
2. Boot: `npm run dev` in the background. dev-guard allows ONE dev server per
   checkout and prints an "already running" banner with the live port when one
   exists - READ the banner, do not assume :3000.
3. Probe against the live port: `/api/health` (200), `/api/comms/capability`
   (relay bit matches what was configured), the landing page (200).
4. If voice was configured: confirm ELEVENLABS_AGENT_ID is now set (the setup
   script writes it) - do not place a live call.
5. Restart note: env changes require a dev-server restart to take effect; if a
   server was already running before step 3, tell the user to restart it.

## Step 5 - the capability matrix

Print one table and make it match what the UI will say - the Getting-started
card and the Channels banner derive from the same server facts, and this
table must not out-promise them:

| feature | state | why | to change |
| --- | --- | --- | --- |
| Workspace, pipeline, JD library, simulation | on | needs nothing | - |
| LLM features | on (claude-cli) / on (provider) / deterministic | ... | Settings -> Models |
| CV analysis | on / off | GEMINI_API_KEY | set it |
| Voice interviews | on / hidden | keys or self-hosted URL | /onboarding voice |
| Comms delivery | sending / queued-only (honest) | relay or edge | /onboarding comms |
| Calendar sync | on / link-based | Google OAuth | /onboarding calendar |
| Auth | open (dev) / password | mode choice | KP_OPERATOR_PASSWORD |

Close with: the demo corpus is already seeded (fresh DB self-seeds); the first
four Getting-started steps (company, first role, case, channels) are the
in-app continuation of this onboarding; and any group answered "later" can be
re-run alone with /onboarding <group>.

## Re-entry

`/onboarding <group>` runs steps 2-5 for that group only. `/onboarding check`
runs steps 1 and 4-5 with no questions - a doctor pass that only reports.

## Portability note (registry)

The generic form of this skill (ai-registry skills lane) reads a per-repo
manifest instead of the hardcoded group table above: group -> vars -> feature
-> limited-without text -> verify URL. When adopting this skill into another
app, move the step-2 table into `onboarding.capabilities.json` and keep the
procedure unchanged. See docs/concepts/local-first-edge.md section 6.
