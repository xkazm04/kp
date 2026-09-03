# Architecture — how the pieces fit

Cross-cutting contracts live in this folder, one file per concern. This page is the
map plus the material that used to sit at the bottom of the root README: the
runtime shape, the source tree, the three default engines and the analysis
pipeline stages.

The contracts below say **what** each piece does.
[**decisions/**](decisions/README.md) says **why** — one ADR per settled choice
that looks surprising on purpose (the pinned canary Next line, one SQLite file,
a spawned Python pipeline, keyless degradation, capability tokens, AGPL, and the
rule that a repo law without a gate isn't a law). Read the relevant record before
proposing to reverse one; each ends with what would change our mind.

## Contracts in this folder

| Doc | Covers |
| --- | --- |
| [decisions/](decisions/README.md) | **Architecture decision records** — the reasoning behind the choices, and what would reopen them |
| [llm-provider-layer.md](llm-provider-layer.md) | The multi-provider LLM wrapper: adapters, capability matrix, key storage, local model servers, benchmarks harness |
| [llm-model-matrix.md](llm-model-matrix.md) | Dated judged quality grid — which model for which recruiter task |
| [engine-setup.md](engine-setup.md) | Setting up the default engines: Claude subscription via the CLI, the ElevenLabs agent, env notes that surprise people |
| [candidate-data-flow.md](candidate-data-flow.md) | **Where a candidate's CV, contact details and transcript actually go** — every hop, what comes to rest, and which model adapters send it off the machine |
| [workspace-data.md](workspace-data.md) | The single SQLite workspace file: seeding, dump & restore |
| [result-caching.md](result-caching.md) | Analyze-route result cache: key, store, invalidation |
| [postgres-backend.md](postgres-backend.md) | The Postgres persistence backend and the portability path |
| [self-hosting.md](self-hosting.md) | Docker / Helm / bare `next start`, air-gap, the edge, production checklist |
| [releases.md](releases.md) | What an operator pins to, the versioning contract, how a tag becomes an image, and the rollback runbook |
| [api-contracts.md](api-contracts.md) | **The two interfaces to get right before changing a handler** — the HTTP envelope/auth/limiter contract every `app/api/**` route follows, and the spawned Python pipeline's wire protocol |
| [api-reference.md](api-reference.md) | **The inventory**: every route, its methods, and whether the fail-closed gate lets an anonymous caller reach it. Generated from `app/api/**` with the auth column computed by `isPublicPath()` itself; `npm run api:check` gates the drift |
| [app-structure.md](app-structure.md) | Rules and live tree of `app/features/**` |
| [localization.md](localization.md) | The four-locale contract |
| [voice-conversation-plane.md](voice-conversation-plane.md), [voice-tts-package.md](voice-tts-package.md) | The two voice planes: live conversation and spoken output |
| [../development/change-review.md](../development/change-review.md) | The two review lenses, and the gate configuration that gives them teeth |

## What stops a change

Around 90% of commits here are AI-written, so "what reads this back, and what
happens when it objects" is a structural question, not a process one. Every
answer is a file in this tree — deliberately, because a gate that lives only in
repository settings cannot be told apart from one that was never wired.

| The gate | Where it is | Fires on |
| --- | --- | --- |
| the fast local gate | [`.githooks/pre-push`](../../.githooks/pre-push) | a push targeting `main`: both review lenses, typecheck, lint, `design:check`, build |
| conventional-commit subjects | [`.githooks/commit-msg`](../../.githooks/commit-msg) + the `commit-convention` job | writing the message, then again over the range in CI |
| the change-reading lenses | [`review.yml`](../../.github/workflows/review.yml) → [`scripts/review/`](../../scripts/review) | every PR, every push to `main`, and on demand |
| the result gates | [`ci.yml`](../../.github/workflows/ci.yml) | typecheck, lint, unit, design, i18n, docs, ADRs, release coherence, SBOM, Python gate, keyless evals, keyless e2e |
| supply chain + SAST | [`security.yml`](../../.github/workflows/security.yml) | CodeQL, `npm audit` (critical blocks), `pip-audit`, weekly |
| **required checks** — what turns any red run into a blocked merge | [`.github/rulesets/main.json`](../../.github/rulesets/README.md) | pull requests to `main` |
| the lens that *writes* — machine-applicable lint fixes, applied | [`autofix.yml`](../../.github/workflows/autofix.yml) | every pull request from this repository |
| the checks that the gates are still *wired* | `review:gate` · `security:actions` · `hooks:check` · `guidance:check`, in `ci.yml` | every push and PR |

The last row is the one that is easy to skip and expensive to omit: a required
check named after a job that was renamed, a hook shelling out to an npm script
that no longer exists, or a new action on a mutable tag all leave every gate
green while it quietly stops holding. See
[change-review.md](../development/change-review.md#keeping-the-gate-wired).

## Runtime shape

The browser talks to Next.js API routes. CV analysis spawns the Python CLI
(`python -m pipeline.jobfit.cli`) as a subprocess and runs it as a background task —
the client polls `/api/tasks/[id]` and the global Tasks indicator tracks progress, so
an analysis survives navigation and page refresh. A deterministic taxonomy pre-pass
runs before the LLM and is fed in as structured evidence so Gemini reconciles its
judgment with what the rules already detected. Results are validated with a Zod
schema generated from the Pydantic models, so the TypeScript UI and Python pipeline
cannot drift apart. There is no second long-lived server to manage.

```text
app/
  page.tsx                          Workspace shell (tab-based studio UI); '/' is gated
                                      server-side between the landing and the workspace
  apply/[id]/ interview/[token]/    Candidate-facing portals (apply chat, voice
  schedule/[token]/ offer/[token]/    interview, self-scheduling, offer)
  control/page.tsx                  Autonomy control room (kill switch, gates, audit)
  interview-lab/page.tsx            Voice-provider A/B harness
  diagrams/page.tsx                 Live PlantUML architecture diagrams
  history/[slug]/ jds/[slug]/       Server-rendered deep links into saved work
  features/                         Tab implementations, mirroring the menu:
                                      hiring/, library/, insights/, settings/, tools/,
                                      shell/ (see app-structure.md for the live tree)
  api/analyze/                      Multi-variant analysis as a background task
  api/tasks/ api/pipeline/          Task polling; pipeline entries + events
  api/interview/ api/schedule/      Voice interview sessions; slot booking
  api/devcase/                      Dev-case lifecycle, postings, submissions, control
  api/automation/                   Run/schedule automation passes
  api/decisions/ api/sim/           Screening waves, group eval; simulation drafts
  api/jds/ api/jobs/ api/templates/ Libraries (JDs, jobs, JD templates)
  api/github-analysis/              GitHub repo-signal deep dive (metadata, not source)
  _lib/db.ts + _lib/db/*            better-sqlite3 wrapper and repository-style stores
                                      (analyses, jds, jobs, profiles, pipeline_entries/
                                      events, tasks, dev_* tables, interview_sessions,
                                      gemini_cache)
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

`pipeline/jobfit/models.py` is the single source of truth for the result shape.
`npm run schemas:gen` regenerates `app/_lib/schemas.generated.ts`. The `build` and
`typecheck` scripts run it automatically; `npm run schemas:check` validates that the
committed file is up to date.

## The three default engines

Three LLM engines are wired by default, each picked for its cost/capability profile:

- **Gemini** (`gemini-3.6-flash`) — the tuned single-analysis path: multimodal CV
  extraction, role-fit scoring, salary estimation with optional Google Search grounding.
- **Claude Code CLI** (headless `claude -p`, billed to a Claude Pro/Max **subscription**,
  not the metered API) — the batch engine for HR automation tasks, dev-case
  design/evaluation, match reasoning, and eval sweeps. The local default.
- **ElevenLabs Conversational AI** (or OpenAI Realtime) — voice agents that run
  first-round screening interviews in Czech or English.

Any of them can be swapped for a provider or a local server of your choosing; none
is load-bearing. Setup for each: [engine-setup.md](engine-setup.md). Which model is
good enough for which task: [../development/benchmarks.md](../development/benchmarks.md)
and [llm-model-matrix.md](llm-model-matrix.md).

## Analysis pipeline stages

1. `extractors.py` — extracts a pypdf baseline from PDF/DOCX/TXT/MD, repairs Czech
   encoding artifacts, and detects the dominant language. Used for both the
   Extraction-tab side-by-side comparison and the bilingual output flag.
2. **Deterministic pre-pass** (`pipeline.py::_build_deterministic_evidence`) — runs
   `taxonomy.py` over the raw text and the company text to detect: role family,
   seniority bucket, anchor salary band (looked up in `data/salary_benchmarks.json`),
   salary signals (cloud / ai / security / devops / leadership / english / german /
   regulated_industry), surface-form skills, company type, company modifiers. Output
   is bundled as a JSON evidence block.
3. `gemini.py` — single Gemini call gets the CV bytes plus the evidence block plus the
   output-language flag and returns the structured analysis: profile, score
   sub-totals, salary range (anchored to the band), optional job-fit, grounded market
   evidence. Uses `gemini-3.6-flash`.
4. `insights.py` — company-type classification, multiplier application (capped at
   1.20×), evidence trace.
5. `ats.py` — JD keyword coverage (matched / missing / over-used) consumed by the
   Job-fit tab.
6. `interview.py` — interview question pack with STAR scaffolds derived from job-fit
   gaps.
7. `taxonomy.py` — single source of truth for skill matching, role-family
   classification, company adjustments, education levels, seniority signals. Backed
   by `data/taxonomy.json`.

The data files behind stages 2 and 7 and the sources they were calibrated against:
[../product/salary-data-sources.md](../product/salary-data-sources.md).
