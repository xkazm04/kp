# KP studio — talent matching

Next.js + TypeScript hiring workspace backed by a Python analysis pipeline. What started as a CV/job-fit/salary analyzer for the Czech market has grown into an end-to-end hiring studio: a pipeline board with stage automation, sourcing channels, AI-assisted screening decisions behind human approval gates, candidate self-scheduling, AI voice screening interviews, a dev-case hiring extension built for the LLM era, and an autonomy control room with a kill switch and audit trail.

Three LLM engines power it, each picked for its cost/capability profile:

- **Gemini** (`gemini-3-flash-preview`) — the production single-analysis path: multimodal CV extraction, role-fit scoring, salary estimation with optional Google Search grounding.
- **Claude Code CLI** (headless `claude -p`, billed to your Claude Pro/Max **subscription**, not the metered API) — the batch engine for HR automation tasks, dev-case design/evaluation, match reasoning, and eval sweeps.
- **ElevenLabs Conversational AI** (or OpenAI Realtime) — voice agents that run first-round screening interviews in Czech or English.

Everything degrades gracefully: features that need an engine you haven't configured fall back to deterministic logic or simply hide.

## 1. Preconditions

| Capability | What you need |
| --- | --- |
| Workspace UI — pipeline board, jobs, JD library, profiles, matrix, simulation | Node 20+, Python 3.11+ (`npm install` + `pip install -r requirements.txt`) |
| CV analysis (Analyze / Match tabs, CLI scripts, eval harness) | `GEMINI_API_KEY` |
| HR automation (screen/outreach/rejection/prep/scorecard/rematch/offer), dev-case design & evaluation, match reasoning | **Claude Code CLI installed and logged in with a Claude Pro/Max subscription** |
| Voice interviews (`/interview/[token]`, Interview-lab) | **`ELEVENLABS_API_KEY`** + `ELEVENLABS_AGENT_ID` (or `OPENAI_API_KEY` for the OpenAI Realtime provider) |
| GitHub repo-signal deep dive | `GITHUB_TOKEN` (optional, raises rate limits) |

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

### Environment reference (`.env.local` in the project root)

```bash
# Required — CV analysis pipeline (Gemini is the only analysis engine)
GEMINI_API_KEY=your_key_here

# Voice interviews — ElevenLabs provider
ELEVENLABS_API_KEY=your_key_here
ELEVENLABS_AGENT_ID=written_by_setup_script

# Voice interviews — optional OpenAI Realtime provider (A/B alternative)
OPENAI_API_KEY=your_key_here
OPENAI_REALTIME_MODEL=gpt-realtime   # default
OPENAI_REALTIME_VOICE=marin          # default

# Optional
GITHUB_TOKEN=your_token_here         # GitHub repo-signal review + rate limits
PYTHON_CMD=python                    # interpreter used to spawn the pipeline
KP_DB_PATH=data/kp.sqlite            # SQLite workspace path
KP_LOG_DIR=tmp                       # JSONL log directory
KP_LOG_PROMPTS=1                     # capture Gemini prompts/responses (PII!)
KP_CACHE_TTL_HOURS=24                # Gemini result cache TTL
COMMS_WEBHOOK_URL=...                # outbound comms relay (dev-case outbox)
AUTOMATION_SCHEDULER_AUTOSTART=1     # start the automation scheduler on boot
```

Note: `ANTHROPIC_API_KEY` is intentionally **not** part of the setup — the Claude CLI engine authenticates through your subscription login, and the spawner strips API-key vars to keep it that way.

## 2. Quick start

```bash
npm install
pip install -r requirements.txt
# create .env.local (see above), then optionally:
node scripts/setup-eleven-agent.mjs   # bootstrap the voice-interview agent
npm run dev
```

Open `http://localhost:3000`. The workspace lands on the **Pipeline** board. `python` must be on the `PATH` of whatever process runs `next dev` / `next start` (override with `PYTHON_CMD`). The SQLite workspace at `data/kp.sqlite` is created and seeded (example JD, jobs, candidate profiles, pipeline entries) on first run.

## 3. Workspace tour

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

## 4. Quick start — CLI

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

## 5. Architecture

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

## 6. Analysis pipeline stages

1. `extractors.py` — extracts a pypdf baseline from PDF/DOCX/TXT/MD, repairs Czech encoding artifacts, and detects the dominant language. Used for both the Extraction-tab side-by-side comparison and the bilingual output flag.
2. **Deterministic pre-pass** (`pipeline.py::_build_deterministic_evidence`) — runs `taxonomy.py` over the raw text and the company text to detect: role family, seniority bucket, anchor salary band (looked up in `data/salary_benchmarks.json`), salary signals (cloud / ai / security / devops / leadership / english / german / regulated_industry), surface-form skills, company type, company modifiers. Output is bundled as a JSON evidence block.
3. `gemini.py` — single Gemini call gets the CV bytes plus the evidence block plus the output-language flag and returns the structured analysis: profile, score sub-totals, salary range (anchored to the band), optional job-fit, grounded market evidence. Uses `gemini-3-flash-preview`.
4. `insights.py` — company-type classification, multiplier application (capped at 1.20×), evidence trace.
5. `ats.py` — JD keyword coverage (matched / missing / over-used) consumed by the Job-fit tab.
6. `interview.py` — interview question pack with STAR scaffolds derived from job-fit gaps.
7. `taxonomy.py` — single source of truth for skill matching, role-family classification, company adjustments, education levels, seniority signals. Backed by `data/taxonomy.json`.

## 7. Testing & evaluation

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

## 8. Data approach

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

## 9. Result caching

To avoid re-paying for identical Gemini calls (a common case while iterating on a JD against the same CV), the analyze route hashes the inputs and reuses a cached payload when one is available.

- **Cache key** — SHA-256 of `(PROMPT_VERSION, grounding flag, JD text + JD file bytes, company text + company file bytes, CV bytes)`. Computed in `app/_lib/cache-key.ts`.
- **Cache store** — `gemini_cache` table in the SQLite workspace DB. Each row carries `payload_json`, `prompt_version`, `created_at`, `expires_at`. Default TTL 24h; override via `KP_CACHE_TTL_HOURS`.
- **Invalidation** — bump `PROMPT_VERSION` in `app/_lib/cache-key.ts` whenever you edit the Gemini prompt, the Pydantic schema, the deterministic pre-pass, or the taxonomy in a way that should drop old results. Old hashes simply miss the lookup; nothing has to be deleted.
- **Behavior** — on cache hit the background analyze task completes near-instantly with the cached result. Each user-visible run still gets a fresh row in the History view regardless of cache state, so the workspace timeline remains accurate.
- **Implicit caching** — Gemini's own context caching for repeated content (within short windows, multi-variant runs against the same JD) is opportunistic and free; we don't manage it.

## 10. Logging

Per-request structured JSONL logs help debug pipeline regressions and track token usage without rerunning the full e2e suite.

| File | Written by | One line per |
| --- | --- | --- |
| `tmp/pipeline.log` | `pipeline/jobfit/logger.py` | `analyze_cv()` invocation — request_id, CV path, JD/company flags, total + per-stage durations, Gemini token usage (`prompt_tokens`, `candidate_tokens`, `total_tokens`, `cached_tokens`), error |
| `tmp/analyze.log` | `app/_lib/logger.ts` | `/api/analyze` request — request_id, route, candidate label, JD slug, `cache_hit` flag, duration, saved slug, error |
| `tmp/github.log` | `app/api/github-analysis/route.ts` | `/api/github-analysis` request — request_id, GitHub user, REST repo count, `code_review` status, duration, error |

Logs are append-only JSONL (one JSON object per line) so they're tail-friendly and grep-able. Override the directory with `KP_LOG_DIR`; the default `tmp/` is gitignored.

Set `KP_LOG_PROMPTS=1` for full Gemini prompt + response capture per request to `tmp/prompts/<request_id>-prompt.txt` and `<request_id>-response.txt`. Off by default since these contain CV PII and can be 5–20 KB each. Useful when chasing a "Gemini returned non-JSON output" regression or comparing prompt revisions.
