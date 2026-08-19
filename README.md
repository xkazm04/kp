# KandiDate (KP studio) — an open-source hiring workspace

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)

A self-hostable recruiting studio: a JD library with AI-assisted job-description
builds, CV analysis and job-fit scoring, a pipeline board with stage automation,
sourcing channels, AI-assisted screening decisions behind human approval gates,
candidate self-scheduling, AI voice screening interviews, work-sample "devcase"
assessments built for the LLM era, a comms outbox, and analytics.

**It runs on your machine, on your models, on your data.** There is no hosted
component in the path of a self-hosted install, nothing phones home, and nothing is
metered — a self-hosted install has no limits at all. That is not a trial edition:
it is the entire product, under **AGPL-3.0** ([`LICENSE`](./LICENSE)).

A [hosted version](#the-hosted-version) exists for teams who would rather not run
servers. It is the same software with the operations handled; it is not a better
version, and nothing here is held back from you to sell there.

> **Note on the AGPL.** Run it internally however you like. If you modify KP and
> offer it to others over a network, §13 requires you to offer those users your
> modified source. Set `NEXT_PUBLIC_SOURCE_REPO_URL` to your fork so the app's own
> footer points at it.

## Run it yourself

```bash
git clone https://github.com/kazimi66/kp.git && cd kp
npm install
pip install -r requirements.txt      # the Python jobfit pipeline
npm run dev
```

Open `http://localhost:3000`. **No API key is required to start.** A fresh checkout
creates and seeds its own SQLite workspace (`data/kp.sqlite`) with a demo corpus —
an example JD, ~100 jobs, candidate profiles, pipeline entries — so you land on a
populated Pipeline board rather than an empty shell.

`python` must be on the `PATH` of whatever process runs `next dev` (override with
`PYTHON_CMD`). Docker and Helm alternatives, plus the production checklist, are in
[`docs/architecture/self-hosting.md`](docs/architecture/self-hosting.md).

### Bring your own model

Every AI call routes to a provider **you** choose. Configure them in
**Settings → Models**, or leave it alone and take the defaults.

| You have | What to do | Cost |
| --- | --- | --- |
| **A local model server** (Ollama, LM Studio, llama.cpp, vLLM, LiteLLM) | Settings → Models → add a key row for `ollama` (or `openai`) and set **Server URL** to e.g. `http://localhost:11434/v1`. No API key needed. | free |
| **A Claude Pro/Max subscription** | Install the Claude Code CLI and `claude` → `/login`. This is the default engine when nothing else is configured. | your subscription, not metered API |
| **A provider API key** | Paste a Gemini / OpenAI / Anthropic / Azure / OpenRouter / Qwen key in Settings → Models. | your provider's bill |
| **Nothing at all** | Nothing. Every LLM feature has a deterministic fallback and the app runs without complaint. | free |

That last row is a **product property**, not a degraded mode we tolerate: the
fallbacks are the same paths that run when a provider is down, so the app never
hard-fails on a missing or rate-limited engine. Features that genuinely cannot
degrade (voice interviews) hide themselves instead of erroring.

Anything you paste is encrypted at rest with `KP_SECRET` (AES-256-GCM), so set that
before saving a key. Full provider layer:
[`docs/architecture/llm-provider-layer.md`](docs/architecture/llm-provider-layer.md).

**Which local model is good enough?** The benchmark below measures real production
prompts across commercial and open models, so you can pick with numbers instead of
vibes. Short version: a local 8B is genuinely fine for single-extraction and
single-decision work and noticeably weaker on multi-deliverable output
(scorecards, campaign packs).

### Air-gapped / no egress

`KP_OFFLINE=1` installs a global egress guard: no outbound network call leaves the
process except to loopback and the private endpoints you configured. Point it at a
local model server and the whole product runs with no internet at all. Both halves
(TypeScript `fetch` guard + the Python engines' own refusal) are application
backstops — a network policy at the deployment layer is still the real guarantee.

### Optional keys

Only set what you actually use. Everything below is opt-in:

| Capability | What you need |
| --- | --- |
| Workspace UI — pipeline board, jobs, JD library, profiles, matrix, simulation | nothing beyond Node 20+ and Python 3.11+ |
| Multimodal CV extraction + salary grounding | `GEMINI_API_KEY` (the strongest single-analysis path; other providers work, this one is tuned) |
| Voice interviews (`/interview/[token]`, Interview-lab) | `ELEVENLABS_API_KEY` + `ELEVENLABS_AGENT_ID`, or `OPENAI_API_KEY` for the OpenAI Realtime provider |
| GitHub repo-signal deep dive | `GITHUB_TOKEN` (optional; raises rate limits) |
| Encrypted provider keys in Settings | `KP_SECRET` |
| A password on the operator routes | `KP_OPERATOR_PASSWORD` — **unset means the app runs fully open**. Fine locally; a production build refuses to start open unless `KP_ALLOW_OPEN=1` says you meant it. |
| Payment plans | `POLAR_*` — only for running KP *as a paid service*. Unset (the normal case) means nothing is metered. |

Full reference: [`.env.example`](./.env.example).

## The hosted version

If you would rather not run a server, the same software is available hosted, with
the servers, backups, upgrades and support handled for you. Plans price outcomes —
a role taken to market, and a person hired — never tokens. Self-hosting is not a
lesser tier of it: it is the same code with no limits.

## Contributing

Bug reports, translations and patches welcome — see
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for the setup, the verification gate, and the
five conventions that actually bite. Security issues go through
[`SECURITY.md`](./SECURITY.md), never a public issue.

---

## Under the hood

Three LLM engines are wired by default, each picked for its cost/capability profile:

- **Gemini** (`gemini-3.6-flash`) — the tuned single-analysis path: multimodal CV
  extraction, role-fit scoring, salary estimation with optional Google Search grounding.
- **Claude Code CLI** (headless `claude -p`, billed to a Claude Pro/Max **subscription**,
  not the metered API) — the batch engine for HR automation tasks, dev-case
  design/evaluation, match reasoning, and eval sweeps. The local default.
- **ElevenLabs Conversational AI** (or OpenAI Realtime) — voice agents that run
  first-round screening interviews in Czech or English.

Any of them can be swapped for a provider or a local server of your choosing; none
is load-bearing.

### Model benchmark — which model should you run? (measured 2026-08-05)

8 production use cases × n=3, run through the real production prompts/fallbacks via
`pipeline/jobfit/llm/bench/`. `claude_cli` Sonnet/Opus; `qwen` = Qwen Cloud API
(qwen3.8-max, glm-5.2, deepseek-v4-flash-0731); `ollama` = local LFM2.5-8B-A1B.
The three axes are kept separate: **quality** is LLM-judged (Claude-CLI judge, 1–10,
over real LLM outputs only — a run that degraded to the deterministic fallback never
feeds quality), while **reliability** and **economics** are measured facts from the
call envelopes. Whether cost or latency binds depends on the op's mode: *online* ops
(match_reasoning, jd_ingest, scorecard, group_compare, weight_proposal) answer to
p50; *background* ops (automation passes, campaign, devcase design) answer to $/task.

**Judged quality** (1–10):

| use case | sonnet | opus | qwen3.8-max | glm-5.2 | deepseek-v4 | lfm2.5:8b |
|---|--:|--:|--:|--:|--:|--:|
| automation_screen | 8.0 | 6.3 | 5.5 | 7.0 | 6.3 | 6.7 |
| campaign_pack | 6.0 | 5.0 | 3.0 | 3.3 | 3.0 | 3.3 |
| devcase_case_design | 8.0 | 7.7 | 3.0 | 3.0 | 3.0 | 6.0 |
| group_compare | 8.3 | 7.0 | 5.0 | 6.5 | 7.0 | 4.3 |
| interview_scorecard | 7.3 | 7.0 | 3.0 | 2.0 | 2.0 | 4.3 |
| jd_ingest | 6.0 | 6.0 | 5.0 | 4.0 | 4.3 | 5.0 |
| match_reasoning | 7.3 | 6.0 | 6.7 | 7.3 | **8.0** | 5.7 |
| weight_proposal | 7.7 | 5.7 | 4.0 | 4.0 | 4.0 | 3.7 |
| **mean** | **7.3** | **6.3** | **4.4** | **4.6** | **4.7** | **4.9** |

**Measured reliability & economics** (8-op means):

| model | llm-rate | $/task | p50 |
|---|--:|--:|--:|
| sonnet (CLI) | 100% | $0.19 | 34.4s |
| opus (CLI) | 100% | $0.31 | 47.5s |
| qwen3.8-max | 66% | $0.020 | 57.0s |
| glm-5.2 | 92% | $0.013 | 41.7s |
| deepseek-v4-flash | 88% | **$0.0015** | 26.9s |
| lfm2.5:8b (local) | 100% | $0 | **12.5s** |

What this table is for: the **open-vs-commercial gap**, not a leaderboard. At n=3
per cell with a Claude-family judge, the Sonnet-vs-Opus ordering is within noise
(and short structured recruiter tasks don't reward the deliberation tier anyway) —
read the commercial columns as one ~7-point tier. The real picture: commercial
Claude holds a ~2.5-point quality lead over every open/challenger model on
multi-deliverable tasks (scorecards, campaign packs, weight rationales), while the
gap nearly closes on single-extraction/single-decision ops — deepseek-v4-flash even
tops match_reasoning at ~1/100th of Sonnet's $/task, and the local 8B is the most
*reliable* challenger (100% served, valid JSON, fastest, $0). Full method, per-op
economics and caveats (qwen-cloud scorecard/devcase runs hit the 2048 maxTokens
ceiling): see
[`docs/architecture/llm-model-matrix.md`](docs/architecture/llm-model-matrix.md).

### Claude subscription (via the Claude Code CLI)

`pipeline/jobfit/claude_cli.py` spawns the headless CLI as a subprocess (`claude -p --output-format json`). It deliberately strips `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` from the child environment so calls run on your interactive subscription login instead of metered API billing — that's what makes hundreds of automation/eval calls affordable. Setup:

1. Install Claude Code (`npm install -g @anthropic-ai/claude-code` or the desktop app) so `claude` resolves on `PATH`.
2. Log in once interactively (`claude` → `/login`) with a Pro/Max account.

If the CLI is missing or not logged in, every consumer (automation tasks, devcase design/evaluate, match reasoning) falls back to its deterministic implementation — the app still runs, just with rule-based output instead of LLM judgment.

### ElevenLabs voice agent

```bash
# Put ELEVENLABS_API_KEY in .env.local first, then:
node scripts/setup-eleven-agent.mjs
```

The script creates the Conversational AI agent straight from the API (multilingual `eleven_flash_v2_5` model, Czech-capable voice, Czech-first interviewer prompt, runtime overrides enabled) and writes `ELEVENLABS_AGENT_ID` back into `.env.local` — no dashboard step needed. Re-running creates a new agent; the newest id wins.

### Environment reference

Every variable, grouped and commented, lives in [`.env.example`](./.env.example) —
copy it to `.env.local` and fill in only what you use. Two notes worth repeating
here because they surprise people:

- `ANTHROPIC_API_KEY` is deliberately **not** part of the setup. The Claude CLI
  engine authenticates through your interactive subscription login, and the spawner
  strips API-key vars from the child environment to keep it that way.
- `KP_LOG_PROMPTS=1` captures prompts and responses to disk. Those contain
  **candidate PII**. It is a debugging switch, not a production setting.

## Development tooling

### DevInspector — click a component, copy its source path

A dev-only overlay for grabbing a component's `app/.../File.tsx:line` and pasting it
straight into an AI coding CLI (Claude Code, etc.). Off by default; never present in
production builds.

```bash
npm run dev:inspect   # dev server with source-location stamping on
npm run dev:empty     # the empty-tenant server (§ below) — inspector on by default
```

In the app, press **`;`** (enters keyboard mode) then **`i`** (Inspect) to arm it. Hover
highlights the element under the cursor and pins a `File.tsx:line` chip; **right-click** copies
the call-site path, **Alt+right-click** copies the innermost element, click a HUD row to copy
any enclosing file, and **Esc** exits. A plain `npm run dev` works too, but the HUD will say
source mapping is OFF until you relaunch with `npm run dev:inspect` — `npm run dev:empty` carries
the same stamping (it exists to look at first-run UI; `-- --no-inspect` turns it off for faster
compiles). A gated Turbopack loader
(`scripts/dev-inspector/`) stamps host JSX with `data-loc` only when `DEV_INSPECT=1`; the overlay
(`app/_dev-inspector/`) reads it at runtime. Both are absent from production.

The loader runs on **Turbopack**, like every other command here. It briefly ran on webpack after
a 2026-06-18 worker-storm incident; a rule `condition` (Next 16) now keeps it off `node_modules`
and Next internals, which was the cause. `npm run dev:inspect:webpack` is the escape hatch if the
Turbopack path ever misbehaves — same stamps, slower compile. See the comment in `next.config.ts`.

### Workspace data — seeding, dump & restore

Everything the app persists lives in **one SQLite file**: `data/kp.sqlite` (override with `KP_DB_PATH`). All ~26 tables — pipeline entries/events, profiles, jobs, analyses, interview sessions & preps, dev cases/postings/submissions/lifecycle, offers, schedule invites, scheduler state, group evals, JD templates, decision config, audit — share that file; `db.ts` and each isolated store create their tables lazily and run their own ALTER-if-missing migrations on boot.

**Seeding.** On first start (or whenever a seeded table is empty) the app auto-loads the committed seed JSONs from `data/seed_*` — `seed_jobs/jobs.normalized.json` (the 100-job corpus the matcher also reads as its default), `seed_candidates/candidates.json`, `seed_analyses/analyses.json`, `seed_pipeline/pipeline.json`. So a fresh checkout needs **no seeding step at all** — `npm run dev` is enough. The seeds themselves are regenerated with the Python generators (LLM-backed, so they need the engines from §1; you only need these to *change* the seed data, never to run the app):

```bash
python -m pipeline.jobfit.seed_jobs --count 150 --workers 6   # synthetic job corpus → data/seed_jobs/
python -m pipeline.jobfit.seed_jobs_csas --count 100          # ČS-flavored corpus variant
python -m pipeline.jobfit.seed_candidates --count 50          # candidate profiles → data/seed_candidates/
python -m pipeline.jobfit.seed_analyses                       # scored analyses → data/seed_analyses/
python -m pipeline.jobfit.seed_pipeline                       # pipeline board rows → data/seed_pipeline/
python -m pipeline.jobfit.seed_interview_calendar             # extra interview slots, written straight into the DB
```

**Dump & restore (move/share/back up a live workspace).** `scripts/db-dump.mjs` exports *every* table (discovered from `sqlite_master`, so new stores are picked up automatically) plus its DDL into one portable JSON file; `scripts/db-load.mjs` restores it:

```bash
npm run db:dump                                   # → data/dumps/kp-dump-<timestamp>.json (gitignored)
npm run db:dump -- --out my-dump.json             # explicit path
npm run db:dump -- --skip gemini_cache,tasks      # leave out the LLM cache / task bookkeeping

npm run db:load -- my-dump.json                   # restore into data/kp.sqlite
npm run db:load -- my-dump.json --replace         # overwrite tables that already have rows
npm run db:load -- my-dump.json --db other.sqlite # restore into a different workspace file
```

Load semantics are deliberately conservative: missing/empty tables are always recreated from the dump's DDL and filled (so seeding a fresh machine needs no flag), but a table that already has rows is only touched with `--replace` — and that check runs over the whole dump up front, so without it either everything loads or nothing does. The load runs in a single transaction; an older dump is carried forward by the app's own boot migrations on next start. Stop the app before restoring into its live workspace. (For a quick same-machine copy you can also just copy `data/kp.sqlite` while the app is stopped — the dump format is for portability, partial loads, and surviving schema drift.)

## Workspace tour

The studio sidebar groups the tabs:

| Group | Tab | What it does |
| --- | --- | --- |
| — | Pipeline | Kanban board of candidates across hiring stages, scheduler control, candidate drawer |
| — | Channels | Sourcing channels feeding the pipeline |
| — | Decisions | AI screening recommendations, group eval, decision rules — all behind human review |
| — | Schedule | Interview calendar, transcripts, prep kits |
| Library | Jobs | Job postings table, ingest, publish, per-job candidates |
| Library | Job descriptions | JD library + template-driven JD builder |
| Tools | Profile | Candidate profile builder (archetype routing + completeness scoring) |
| Tools | Match | Rank the candidate pool against a job (KO filters + scoring + LLM reasoning) |
| Tools | Analyze | The original CV/job-fit/salary analysis (multi-variant compare, history) |
| Tools | Interview sim | End-to-end pipeline simulation (Design JD → Source → Intake → Screen → Interview → Offer → Hired) with synthetic candidates |
| Dev extension | Dev cases | Case-scenario hiring for developers (see below) |
| Insights | Analytics / Matrix / About | Decision log, candidate × JD pivot, methodology docs |

Standalone pages outside the workspace shell:

- `/apply/[id]` — public, formless conversational apply portal (chat-based knockout questions).
- `/interview/[token]` — candidate-facing voice screening interview (consent, transcription notice, fixed provider per session).
- `/schedule/[token]` — candidate self-scheduling (pick a slot, get confirmation).
- `/offer/[token]` — candidate-facing offer accept/decline.
- `/control` — autonomy control room: automation kill switch, pending human gates, lifecycle tracking, immutable audit trail, outcomes & calibration.
- `/interview-lab` — internal A/B harness comparing voice providers (ElevenLabs vs OpenAI Realtime) in Czech/English.
- `/diagrams` — live-rendered PlantUML architecture diagrams from `docs/diagrams/`.

### Dev-case hiring extension

`pipeline/jobfit/devcase/` implements case-scenario hiring that assumes 100% of candidate code is LLM-generated, so it grades durable capabilities instead of lines of code: problem framing, tooling fluency, judgment/verification, architecture, transfer. The lifecycle runs Need analysis → Role + case design (with covert probes: ambiguity, legacy trap, verification trap, underspecification) → Publish to channels → Submission intake (repo + commit reflection) → Evaluation (reflection + tooling signal + rubric → transfer score) → case-grounded interview brief. Design and evaluation use the Claude CLI with deterministic fallbacks; an LLM-free policy pass auto-advances/rejects on rules with fairness gates — early-career candidates are never silently auto-advanced or auto-rejected.

### Voice interviews

A recruiter (or the automation) creates an interview session; the candidate opens `/interview/[token]`, consents, and talks to the agent. Server-side, `app/_lib/voice/elevenlabs.ts` mints a signed URL for the dashboard-free agent (browser connects via `@elevenlabs/react`); the OpenAI provider mints ephemeral Realtime secrets instead. The interviewer asks 3–4 grounded questions (per-candidate prompt overrides), the transcript is stored in `interview_sessions`, and a scorecard is generated on completion. No feedback or decisions are given to the candidate.

## Command-line usage

When you only need one slice — a salary check, a job-fit gap list, keyword coverage — `scripts/` ships focused command-line entry points that call the same pipeline (`pipeline.jobfit.service.analyze`) and print well-formatted, color-aware terminal output.

All scripts accept any CV format the UI accepts (PDF, DOCX, TXT, MD), read `GEMINI_API_KEY` from `.env.local` / your shell, log per-stage progress on stderr (silence with `--quiet`), and degrade to plain text on non-TTY stdout (or set `NO_COLOR=1`).

| Script | What it shows |
| --- | --- |
| `scripts/analyze.py` | Full overview: profile, score breakdown, salary, strengths/gaps, recommendations |
| `scripts/salary.py` | Salary view: anchor band, final range, company multiplier, grounded market evidence |
| `scripts/jobfit.py` | Job-fit scoring: matching/missing skills, talking points, risk flags, keyword coverage |
| `scripts/interview.py` | Interview pack: questions grouped by bucket with STAR scaffolds |
| `scripts/compare.py` | Side-by-side comparison of 2+ CV variants against one JD |

```text
cv                  Positional — path to the CV/profile file (or 2+ paths for compare.py).
--jd PATH           Job description file.
--jd-text "…"       Inline job description (use instead of --jd).
--company PATH      Company overview file.
--company-text "…"  Inline company overview.
--grounding         Enable Google Search grounding for live market context.
--quiet             Suppress stage progress on stderr.
```

```bash
python scripts/analyze.py samples/sample-cv.txt --jd path/to/jd.txt
python scripts/salary.py samples/sample-cv.txt --company-text "Multinational bank in Prague" --grounding
python scripts/jobfit.py samples/sample-cv.txt --jd-text "Senior Python + AWS SRE, English C1"
```

Beyond the analysis scripts, the Python package ships operational CLIs:

```bash
python -m pipeline.jobfit.cli samples/sample-cv.txt        # core analysis (JSON out)
python -m pipeline.jobfit.automation_cli screen            # HR automation tasks: screen|outreach|rejection|prep|scorecard|rematch|offer|policy-pass
python -m pipeline.jobfit.devcase.devcase_cli              # dev-case lifecycle
python -m pipeline.jobfit.devcase.lifecycle_eval --count 5 # dev-case eval harness (--judge / --audit for LLM passes)
python -m pipeline.jobfit.reasoning_cli                    # match reasoning (Claude CLI)
```

## Architecture

The browser talks to Next.js API routes. CV analysis spawns the Python CLI (`python -m pipeline.jobfit.cli`) as a subprocess and runs it as a background task — the client polls `/api/tasks/[id]` and the global Tasks indicator tracks progress, so an analysis survives navigation and page refresh. A deterministic taxonomy pre-pass runs before the LLM and is fed in as structured evidence so Gemini reconciles its judgment with what the rules already detected. Results are validated with a Zod schema generated from the Pydantic models, so the TypeScript UI and Python pipeline cannot drift apart. There is no second long-lived server to manage.

```text
app/
  page.tsx                          Workspace shell (tab-based studio UI)
  apply/[id]/ interview/[token]/    Candidate-facing portals (apply chat, voice
  schedule/[token]/ offer/[token]/    interview, self-scheduling, offer)
  control/page.tsx                  Autonomy control room (kill switch, gates, audit)
  interview-lab/page.tsx            Voice-provider A/B harness
  diagrams/page.tsx                 Live PlantUML architecture diagrams
  history/[slug]/ jds/[slug]/       Server-rendered deep links into saved work
  features/                         Tab implementations (sub_analyze, sub_pipeline,
                                      sub_dev, sub_decisions, sub_match, sub_jobs,
                                      sub_schedule, simulation, tasks, …)
  api/analyze/                      Multi-variant analysis as a background task
  api/tasks/ api/pipeline/          Task polling; pipeline entries + events
  api/interview/ api/schedule/      Voice interview sessions; slot booking
  api/devcase/                      Dev-case lifecycle, postings, submissions, control
  api/automation/                   Run/schedule automation passes
  api/decisions/ api/sim/           Screening waves, group eval; simulation drafts
  api/jds/ api/jobs/ api/templates/ Libraries (JDs, jobs, JD templates)
  api/github-analysis/              GitHub repo-signal deep dive (metadata, not source)
  _lib/db.ts                        better-sqlite3 wrapper (analyses, jds, jobs,
                                      profiles, pipeline_entries/events, tasks,
                                      dev_* tables, interview_sessions, gemini_cache)
  _lib/python-runner.ts             Spawn helper: workdir, CLI args, output capture
  _lib/voice/                       ElevenLabs + OpenAI Realtime provider adapters
  _lib/schemas.generated.ts         Zod schema generated from pipeline/jobfit/models.py
pipeline/jobfit/                    Python analysis package
  cli.py / service.py / pipeline.py Entry points + Gemini orchestration
  gemini.py                         Gemini call; evidence injection, output language
  claude_cli.py                     Headless Claude Code CLI provider (subscription)
  extractors.py / profiling.py      PDF/DOCX/TXT/MD extraction, Czech repair, fallback
  taxonomy.py / registry.py         Skill/company/education matching; archetypes
  matching.py / match_reasoning.py  KO filters + pool scoring; LLM match reasoning
  insights.py / ats.py / interview.py  Company multiplier; keyword coverage; questions
  automation_cli.py                 HR automation tasks (Claude CLI + det. fallback)
  devcase/                          Dev-case hiring: analyze, design, source, evaluate,
                                      reflect, lifecycle_eval, interview_scenario
  eval/                             Golden-set + matching + automation eval harnesses
  models.py / codegen.py            Pydantic source of truth → Zod codegen
data/                               salary_benchmarks.json, taxonomy.json, seeds
data/kp.sqlite                      Workspace persistence (gitignored)
samples/                            Fixture CV/profile files
e2e/                                Playwright specs
docs/diagrams/                      PlantUML sources rendered on /diagrams
```

`pipeline/jobfit/models.py` is the single source of truth for the result shape. `npm run schemas:gen` regenerates `app/_lib/schemas.generated.ts`. The `build` and `typecheck` scripts run it automatically; `npm run schemas:check` validates that the committed file is up to date.

## Analysis pipeline stages

1. `extractors.py` — extracts a pypdf baseline from PDF/DOCX/TXT/MD, repairs Czech encoding artifacts, and detects the dominant language. Used for both the Extraction-tab side-by-side comparison and the bilingual output flag.
2. **Deterministic pre-pass** (`pipeline.py::_build_deterministic_evidence`) — runs `taxonomy.py` over the raw text and the company text to detect: role family, seniority bucket, anchor salary band (looked up in `data/salary_benchmarks.json`), salary signals (cloud / ai / security / devops / leadership / english / german / regulated_industry), surface-form skills, company type, company modifiers. Output is bundled as a JSON evidence block.
3. `gemini.py` — single Gemini call gets the CV bytes plus the evidence block plus the output-language flag and returns the structured analysis: profile, score sub-totals, salary range (anchored to the band), optional job-fit, grounded market evidence. Uses `gemini-3.6-flash`.
4. `insights.py` — company-type classification, multiplier application (capped at 1.20×), evidence trace.
5. `ats.py` — JD keyword coverage (matched / missing / over-used) consumed by the Job-fit tab.
6. `interview.py` — interview question pack with STAR scaffolds derived from job-fit gaps.
7. `taxonomy.py` — single source of truth for skill matching, role-family classification, company adjustments, education levels, seniority signals. Backed by `data/taxonomy.json`.

## Testing & evaluation

```bash
npm run lint
npm run typecheck         # also regenerates the Zod schema
npm run test:unit         # Node --test over app/**/*.test.ts (no jest/vitest)
npm run test:python       # python -m unittest discover pipeline/jobfit/tests
npm run test:python:gate  # gated runner with skip baseline
npm run test:e2e          # Playwright; Analyze suite auto-skips when no GEMINI_API_KEY
npm run test:eval         # golden-set eval (markdown report)
npm run test:eval:strict  # eval + non-zero exit when thresholds fail
npm run test:eval:match   # matching-quality eval (strict)
```

The Python suite covers insights rules, PDF parsing quality, the matching engine, the Claude CLI provider, the automation tasks, fairness gates, and the full devcase module (analyze/design/source/evaluate/reflect/provenance). Tests that would need a live LLM are skipped unless enabled (`KP_CLAUDE_CLI_LIVE=1`). Playwright splits into `e2e/analyze-smoke.spec.ts` (LLM-backed Analyze flow across input combinations, skips cleanly without a Gemini key, includes a11y checks) and `e2e/profile-builder.spec.ts` (deterministic build/save round-trip, no API key needed).

### Eval harness

`pipeline/jobfit/eval/` ships a 14-fixture golden set of synthetic CVs covering the role × seniority × language matrix plus deliberate edge cases:

- **Core roles**: junior frontend, medior data engineer, senior Python+AI, senior DevOps+security, senior PM, Czech-language lead engineer.
- **Edge cases**: senior iOS engineer, PhD-to-industry data scientist, Czech-language junior QA, CTO/co-founder (no recent code), career switcher (teaching → backend), very short CV, OSVČ freelancer with diverse engagements, COBOL/mainframe legacy specialist.

Each fixture is hand-verified (`label`, `expected_role_family`, `expected_seniority`, `expected_salary_range`, `expected_skills_subset`, optional `expected_education` / `expected_signals_subset` / `expected_language`). Multi-valued expectations are supported (e.g., `["data_ai", "software_engineering"]` for genuinely ambiguous AI engineers). The runner scores every fixture on four axes:

| Metric           | Threshold |
| ---------------- | --------- |
| `role_family`    | 85%       |
| `seniority`      | 70%       |
| `salary_overlap` | 60%       |
| `skill_recall`   | 75%       |

`salary_overlap` is containment-aware — a Gemini range fully inside the expected band scores 1.0; partial overlaps fall back to IoU. The aggregate report and per-fixture breakdown print as a markdown table; `--json` swaps in machine-readable output for CI; `--strict` exits non-zero when any threshold is missed. Use it after every prompt or taxonomy change to catch drift.

Beyond the golden set: `eval/matching_eval.py` scores the matching engine, `eval/automation_eval.py` scores the automation tasks, and `devcase/lifecycle_eval.py` hardens the dev-case design loop (scenario generation, reliability/integrity health checks, optional LLM design audits).

## Data approach

`data/salary_benchmarks.json` carries role × seniority anchor bands per family (`software_engineering`, `data_ai`, `product_project`). The deterministic pre-pass looks up the band that matches the candidate's detected role family + seniority and feeds it into the Gemini prompt as the *primary* salary anchor; Gemini may adjust ±20% with stronger evidence. `data/taxonomy.json` (151 terms, 8 salary signals, 5 company types, 3 modifiers) drives skill matching, role classification, education detection, seniority signals, and the company-type multiplier (capped at 1.20×). Both files are editable without changing the API/UI contract.

### Czech salary data (job-board aggregates)

- [Platy.cz — Information Technology category](https://www.platy.cz/en/salaryinfo/information-technology) — backend 49–136k, frontend 45–115k, iOS 75–181k, Android 65–150k, DevOps 62–155k, QA manual 38–83k, QA automation 46–107k, security analyst 48–129k, data scientist 56–123k, BI analyst 51–114k, product manager 61–164k. Average IT 81,634 CZK. Used to validate role bands and to size the DevOps/security/mobile salary signals.
- [Platy.cz — Public administration / self-governance](https://www.platy.cz/en/salaryinfo/public-administration-self-governance) — public-admin 80% earn 29.8–65.0k CZK, average 46k. Used to recalibrate the `public sector` company-adjustment factor down from 0.86 to 0.80.
- [Levels.fyi — Software Engineer, Czech Republic](https://www.levels.fyi/t/software-engineer/locations/czech-republic) — average SWE TC 1,480,987 CZK/yr, range 1.1–1.87M; Prague +29% vs CZ average. Cross-check on Platy.cz bands.
- [Glassdoor — Senior Software Engineer, Prague](https://www.glassdoor.com/Salaries/prague-senior-software-engineer-salary-SRCH_IL.0,6_IM989_KO7,31.htm) — senior SWE 1.48–2.19M CZK/yr; junior 740k–1.2M; mid 1.2–1.7M. Cross-check.

### Czech salary guides (recruitment agencies)

- [Hays Czech Republic salary guide](https://www.hays.cz/en/salary-guide) — confirms top in-demand IT skills (cloud, cybersecurity, software development); raw numbers gated. Used as directional context.
- [Grafton Recruitment CZ Salary Guide 2025](https://www.grafton.cz/en/employers/survey-zone/salary-guide-2025) — 11th edition, 350 positions × 8 sectors. Landing page only.
- [Reed Czech Republic 2026 Salary Guide](https://www.reedglobal.cz/en/resources/salary-guide) — landing page only.
- [Cpl CEE 2025 Salary Guide announcement](https://www.cz.cpl.com/en/blog/2025/02/cee-salary-guide-2025-new-report) — covers IT & Tech across CZ/SK/PL. Landing page only.

### Market analyses + premium sizing

- [Kitalent — Prague ICT multinational wage war](https://kitalent.com/article-prague-ict-multinational-wage-war) — senior SWE 100–150k, principal/architect 150–200k, VP Engineering 220–350k, CISO 200–400k; multinational base premium 30–40% vs scaleups; cybersecurity mover premia 25–35%; AI/ML salary inflation 10–12% annual through 2026 vs 6–8% general ICT. Source for `enterprise/corporate` factor revision and for the new `security` salary signal.
- [Nucamp — Top 10 high-paying tech jobs in Czech Republic 2025](https://www.nucamp.co/blog/coding-bootcamp-czech-republic-cze-ranking-the-top-10-highpaying-tech-jobs-in-czech-republic-in-2025) — Data Scientist 650k–1.5M/yr, AI 1.1–2M/yr, ML 850k–1.5M/yr, Cloud up to 1.6M/yr, Cyber 800k–1.5M/yr; AI/ML +20–30% premium; Prague +25% over national. Used to validate `ai`, `cloud`, `security` signals.
- [Nucamp — Most in-demand tech jobs in Czech Republic 2025](https://www.nucamp.co/blog/coding-bootcamp-czech-republic-cze-most-in-demand-tech-job-in-czech-republic-in-2025) — top demand for Python, Java, JS, cloud, cybersecurity, data; 18% market growth for software developer roles; 63% of CZ IT firms struggling to hire. Source for the broad skills additions.
- [MV People Group — European Cybersecurity Salary Guide 2026](https://www.mvpeoplegroup.com/en/insights/cybersecurity-salary-guide-europe-2026) — NIS2/DORA experts EUR 70–107k; CISO EUR 120–197k. Used to add the `security` salary signal and `regulated_industry` modifier.

### Czech press + statistics

- [Expats.cz — Salary leaders: Czechia's best-paying industries and locations](https://www.expats.cz/czech-news/article/salary-leaders-czechia-s-best-paying-industries-and-locations) — private sector growth 7.9% vs public 3.4%; Prague avg 63,106; senior comp tech Prague 90,207 vs Vysočina 64,111; 2025 outlook 5.5–6%.
- [Expats.cz — IT roles offering a good start](https://www.expats.cz/czech-news/article/it-roles-that-offer-good-start-to-career-and-salary) — entry-level IT: security 75k/mo, dev/data 62.5k/mo, PM coordinator 50k/mo. Confirms the startup-vs-large-company entry gap and informs the `startup` factor.
- [Expats.cz — Czech salary guide vs national average](https://www.expats.cz/czech-news/article/czech-salary-guide-do-you-earn-more-than-the-national-average-for-your-industry) — IT industry average ~74k CZK (highest of all industries); backend >80k, top-decile >115k. Cross-check.

### Regulation (drives `regulated_industry` and `security` signals)

- [ICLG — Cybersecurity Laws and Regulations: Czech Republic 2026](https://iclg.com/practice-areas/cybersecurity-laws-and-regulations/czech-republic) — Czech New Cybersecurity Act effective 1 Nov 2025 (NIS2 transposition); DORA from 17 Jan 2025; penalties to CZK 250M.
- [Cybersecurity Hub CZ — NIS2 Ready](https://www.cybersecurityhub.cz/en/opportunities/nis2ready) and [Deloitte CZ — NIS2 directive and the new Cybersecurity Act](https://www.deloitte.com/cz-sk/en/services/consulting/services/nis2-directive-and-the-new-cybersecurity-act.html) — implementation context for the compliance-related salary lift.

### Czech vocabulary + education titles

- [Coderslab — Junior, medior, senior in Czech IT](https://coderslab.cz/cz/blog/jak-se-lisi-junior-medior-senior) — confirms `samostatně` (independently) as the canonical medior signifier. Junior = nováček; senior = 5+ years.
- [Czechitas — Overview of basic IT positions](https://www.czechitas.cz/blog/prehled-zakladnich-it-pozic-s-czechitas) — Czech IT job-title vocabulary: programátor, vývojář, architekt, tester, analytik, datový analytik, projektový/produktový manažer, databázový inženýr, administrátor, konzultant, technická podpora.
- [CzechUniversities — Academic title spelling](https://www.czechuniversities.com/article/list-of-academic-titles-and-their-correct-spelling) — canonical CZ academic titles: Bc., BcA., Mgr., MgA., Ing., Ing. arch., MBA, Ph.D., JUDr., RNDr., MUDr., MVDr., MDDr., PharmDr., DrSc.

### Consulting / Big-4 references (for `agency/consultancy` factor)

- [Salary.com — Deloitte Czech Republic Consultant](https://www.salary.com/research/company/deloitte-czech-republic/consultant-salary) — Deloitte CZ consultant 44–58k/mo. Used to lower the `agency/consultancy` factor from 1.02 to 1.00.

### Sources attempted but gated or unavailable

Hays CZ 2026 PDF, Grafton 2025 PDF, Reed 2026 PDF, Cpl CEE 2025 PDF — all behind download forms; landing pages only. Robert Half does not publish a CZ-specific guide for 2025/2026; their CEE coverage rolls into Manpower/Hays. ČSÚ wage tables were referenced only via Nucamp's summary citing the 18% software-developer growth figure.

---

## Result caching

To avoid re-paying for identical Gemini calls (a common case while iterating on a JD against the same CV), the analyze route hashes the inputs and reuses a cached payload when one is available.

- **Cache key** — SHA-256 of `(PROMPT_VERSION, grounding flag, JD text + JD file bytes, company text + company file bytes, CV bytes)`. Computed in `app/_lib/cache-key.ts`.
- **Cache store** — `gemini_cache` table in the SQLite workspace DB. Each row carries `payload_json`, `prompt_version`, `created_at`, `expires_at`. Default TTL 24h; override via `KP_CACHE_TTL_HOURS`.
- **Invalidation** — bump `PROMPT_VERSION` in `app/_lib/cache-key.ts` whenever you edit the Gemini prompt, the Pydantic schema, the deterministic pre-pass, or the taxonomy in a way that should drop old results. Old hashes simply miss the lookup; nothing has to be deleted.
- **Behavior** — on cache hit the background analyze task completes near-instantly with the cached result. Each user-visible run still gets a fresh row in the History view regardless of cache state, so the workspace timeline remains accurate.
- **Implicit caching** — Gemini's own context caching for repeated content (within short windows, multi-variant runs against the same JD) is opportunistic and free; we don't manage it.

## Logging

Per-request structured JSONL logs help debug pipeline regressions and track token usage without rerunning the full e2e suite.

| File | Written by | One line per |
| --- | --- | --- |
| `tmp/pipeline.log` | `pipeline/jobfit/logger.py` | `analyze_cv()` invocation — request_id, CV path, JD/company flags, total + per-stage durations, Gemini token usage (`prompt_tokens`, `candidate_tokens`, `total_tokens`, `cached_tokens`), error |
| `tmp/analyze.log` | `app/_lib/logger.ts` | `/api/analyze` request — request_id, route, candidate label, JD slug, `cache_hit` flag, duration, saved slug, error |
| `tmp/github.log` | `app/api/github-analysis/route.ts` | `/api/github-analysis` request — request_id, GitHub user, REST repo count, `code_review` status, duration, error |

Logs are append-only JSONL (one JSON object per line) so they're tail-friendly and grep-able. Override the directory with `KP_LOG_DIR`; the default `tmp/` is gitignored.

Set `KP_LOG_PROMPTS=1` for full Gemini prompt + response capture per request to `tmp/prompts/<request_id>-prompt.txt` and `<request_id>-response.txt`. Off by default since these contain CV PII and can be 5–20 KB each. Useful when chasing a "Gemini returned non-JSON output" regression or comparing prompt revisions.
