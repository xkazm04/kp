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

**The background runner is fair across tenants.** `app/_lib/tasks.ts` keeps at most
`MAX_CONCURRENT` (2) handlers in flight process-wide — the Claude CLI rate ceiling, not
a per-team quota. Which queued task fills a free slot is a separate, pure decision in
`app/_lib/task-pump.ts`: among the queued tasks, run the one whose **workspace** holds
the fewest running slots, ties broken by queue position. A single tenant's queue is
therefore unchanged (plain FIFO), while one team can never hold both slots — each an
LLM run measured in minutes — against another team that has anything queued. Boot
recovery re-enqueues orphaned `queued` rows with the workspace each row carries
(`listQueuedTaskEntries`), so a restart cannot collapse every recovered task onto one
tenant and undo the rule. Every handler in the `HANDLERS` table declares `tenancy`:
`scoped` (its run reaches `ctx.workspaceId`) or `tenant-free` with the reason on the
line; `app/_lib/tasks-pump.test.ts` fails on a kind that declares neither, and on a
`scoped` one whose handler never actually reads the workspace. Durable, cross-restart
queueing remains out of scope — the `tasks` row is the source of truth, and a run
orphaned mid-flight is marked `interrupted` rather than resumed.

Three kinds are **late-bound**: `jobseeker_scan`, `interview_kit` and `interview_letter`
call `externalRunner(kind)` (`app/_lib/task-external-runners.ts`, a leaf registry on
`globalThis`) instead of importing their runner. `tasks.ts` sits on every route that
starts or polls a task, and the perf budget counts every module it reaches, dynamic
imports included. `registerLateBoundImplementations()` (`app/_lib/late-bound-boot.ts`)
registers the implementations at boot: `instrumentation-node.ts` calls it at server
start, and `app/_lib/testing/unit-db.ts` calls it in every unit-test process. Each
runner module still loads lazily on first use. An unregistered kind fails its task
with an error naming the registration, and `app/_lib/late-bound-boot.test.ts` fails on
a kind `tasks.ts` delegates that the boot list does not register.

**Task identity.** `app/_lib/task-dedupe.ts` keys each in-flight run so a retry
coalesces and a different request does not. `batch_screen` used to be a process-wide
singleton (`"batch_screen"`); it is now the sorted `entryIds` cohort (the board
row's AI-evaluate), or `batch_screen:<workspaceId>` for the legacy full-board sweep
with no ids. Two roles can be evaluated at once without swapping verdicts. Lookup
is already per-workspace (`getActiveTaskByDedupe`), so the cohort fingerprint is
what stops same-tenant cross-role contamination.

**One kind vocabulary.** The task kinds are a closed list, `TASK_KINDS` in
`app/_lib/task-kinds.ts`, with the derived `TaskKind` union and an `isTaskKind` guard.
The module has no imports, so both the client and the unit runner can read it. Every
per-kind table is keyed `Record<TaskKind, …>`: the handler registry (`HANDLERS` in
`tasks.ts`), the budget class (`TASK_BUDGET_CLASS` in `task-budget.ts`), the dedupe
identity (`DEDUPE_BUILDERS` in `task-dedupe.ts`, where `null` means "no stable
identity, never merge", as for `profile_draft`), and the outcome decision (`TABLE`
and `NO_TABLE_SUMMARY` in `task-outcome-summary.ts`, typed as a partition). To add a
kind, add one entry to `TASK_KINDS`; `tsc` then lists every table that still has to
decide what the new kind does. The client's `startTask` accepts only a `TaskKind`, so
a misspelled kind at a call site fails to compile instead of returning a 400 at
runtime. The runtime guard is still there for request bodies and for rows written by
an older build: POST `/api/tasks` refuses an unknown kind with `TASK_KIND_UNKNOWN`.
Runners registered only on the late-bound seam, such as `intake_round`, are not
kinds.

**Door and seat per kind.** `TASK_KIND_ADMISSION` in `app/_lib/task-admission.ts` is
another `Record<TaskKind, …>` table. For each kind it records a door and a
capability. The door is `dock` when the client may start the kind through POST
`/api/tasks` with its own params. It is `server` when only a dedicated route builds
the params and enqueues the task. Nine kinds are server kinds: `analyze`,
`lifecycle`, `jd_build`, `repo_scan`, `agent_fit`, `interview_kit`,
`interview_letter`, `companion_digest` and `jobseeker_scan`. The dock refuses them
with 403 `TASK_KIND_SERVER_ONLY`, after the overall IP bucket and before the
per-class budget. `analyze` is the reason the rule exists: its params are paths into
the workdir that `/api/analyze` built. `runAnalyze` and `cleanupWorkdir` still refuse
any path outside a jobfit workdir on their own, whatever the door does. The
capability is what a start, retry or cancel of the kind asks of the caller's seat.
Today every kind asks `pipeline:write`, so a viewer can watch the dock but cannot
start, replay or cancel a run. Retry and cancel ask the capability of the stored
row's kind, after the tenant read. Retry does not apply the door rule, because it
replays params that a server route wrote. POST `/api/tasks/seen` asks `read`.
`task-admission.test.ts` reads the tree and fails when a kind that a client starts
is not a dock kind, or when a kind that only server modules enqueue is not a server
kind.

**Fan-out outcomes and scoped retry.** The two kinds that run one automation per
entry of a cohort, `batch_screen` and `batch_outreach`, store a per-candidate ledger
in their result: `results: [{ id, ok, applied?, code? }]`. It holds ids and machine
tokens only, because the `tasks` table is erasure-exempt and not entry-keyed. A
failed item carries a code (an `AutomationRefusal` such as `entry_has_no_profile`,
or `engine_failed`), never the thrown message, which can carry a Python traceback or
the workdir path. An outreach item keeps its `applied` value, so a letter that was
suppressed for consent or anonymization is not counted as sent. `app/_lib/task-fanout.ts`
is the pure reader. It turns a row (params, result, status) into delivered,
suppressed, failed-by-code and unreached id sets. Only a run that stopped has an
unreached remainder: the cohort minus the recorded ids. It also holds
`retryDecision(task, scope)`, which POST `/api/tasks/[id]/retry` calls before any
rate-limit bucket. With no body the route replays the whole run, as before, and only
for a failed, interrupted or canceled row. With `{ scope: "failed" | "unreached" }`
it re-enqueues only that subset, derived from the stored row and never sent by the
client, and it does so even for a succeeded run with failures. The subset is a
different cohort, so it gets its own dedupe identity and never merges onto the old
run. It spends the same per-class budget. The Background-tasks drawer
(`TasksOutcome.tsx`) shows the failure codes, the not-reached count and one button
per available scope. Older rows that stored counts only offer no subset retry,
because counts cannot say which candidates to retry.

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
