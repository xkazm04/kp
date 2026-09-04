# Features

These documents describe the **implemented** product surface — what the app does today,
with the files that do it. They are written for developers and for agents that need a
stable reference before touching code.

Not-yet-built work lives in [../concepts/](../concepts/); market and roadmap framing lives
in [../product/](../product/); superseded material lives in [../_archive/](../_archive/).

## The hiring loop

| Area | Doc | Implementation roots |
| --- | --- | --- |
| Jobs & JD lifecycle | [jobs/README.md](jobs/README.md) | `app/_lib/job-ingest.ts`, `app/_lib/jd-lint.ts`, `app/api/jobs`, `app/api/jds`, `app/features/library/jobs`, `pipeline/jobfit/campaign.py` |
| Candidate intake & CV analysis | [candidates/README.md](candidates/README.md) | `app/_lib/apply*.ts`, `app/_lib/analyze-run.ts`, `app/api/apply`, `app/features/tools/{analyze,profile}`, `pipeline/jobfit/profile.py` |
| Matching & scoring | [matching/README.md](matching/README.md) | `pipeline/jobfit/{matching,taxonomy,transform,transferable,weight_proposal}.py`, `app/features/insights/matrix` |
| Pipeline & automation | [pipeline/README.md](pipeline/README.md) | `app/_lib/{pipeline-stages,automation-run,screen-wave,decision-config-store}.ts`, `app/api/automation`, `app/features/hiring/{pipeline,decisions}`, `pipeline/jobfit/automation.py` |
| Dev cases | [dev-case/README.md](dev-case/README.md) | `app/_lib/devcase-*.ts`, `app/api/devcase`, `app/features/tools/devcases`, `app/devcase/apply`, `pipeline/jobfit/devcase/**` |
| Interview scheduling | [scheduling/README.md](scheduling/README.md) | `app/_lib/schedule-{slots,store}.ts`, `app/_lib/calendar/**`, `app/api/schedule`, `app/api/calendar`, `app/schedule`, `app/features/hiring/schedule` |
| Interviews (voice) | [interviews/README.md](interviews/README.md) | `app/_lib/voice/**`, `app/api/interview`, `app/interview`, `app/interview-lab`, `app/_components/voice` |
| Candidate comms | [comms/README.md](comms/README.md), [comms/outbound-export.md](comms/outbound-export.md) | `app/_lib/comms*.ts`, `app/api/comms`, `app/api/channels`, `app/features/hiring/channels` |
| Agents (agent-candidate bridge) | [agents/README.md](agents/README.md) | `app/_lib/agent-hire/**`, `app/_lib/db/agents.ts`, `app/api/agents`, `app/features/agents-workforce`, `app/features/library/jobs/JobsAgentFit*`, `pipeline/jobfit/agentfit.py` |

## Platform

| Area | Doc | Implementation roots |
| --- | --- | --- |
| Compliance & trust | [compliance/README.md](compliance/README.md), [compliance/ai-act-conformity.md](compliance/ai-act-conformity.md) | `app/_lib/{consent,decision-record-store,trust-posture,status-decisions}.ts`, `app/trust`, `app/data/[token]`, `app/status/[token]` |
| Organization, identity & tenancy | [organization/README.md](organization/README.md) | `app/_lib/db/{organizations,users,memberships,invites}.ts`, `app/_lib/auth/**`, `app/_lib/tenancy.ts`, `app/features/settings/organization` |
| Integrations (calendar, inbound ATS) | [integrations/README.md](integrations/README.md) | `app/_lib/calendar/**`, `app/_lib/ats/connections-store.ts`, `app/api/calendar`, `app/api/ats/connections`, `app/features/settings/integrations` |
| Billing | [billing/README.md](billing/README.md) | `app/_lib/billing/**`, `app/api/billing`, `app/features/settings/billing`, `scripts/polar-setup.mjs` |
| About (in-app explainer deck) | [about/README.md](about/README.md) | `app/features/insights/about/**` |
| Public marketing pages (`/`, `/about`, `/market`) | [marketing/README.md](marketing/README.md) | `app/landing/spark/**`, `app/about`, `app/market`, `scripts/build-market-pulse.mjs`, `scripts/lib/market-earnings.mjs`, `data/market_pulse.json` |

Cross-cutting contracts (LLM provider layer, persistence backend, self-hosting, app
structure) are in [../architecture/](../architecture/). The design system is in
[../design/](../design/).

## Workspace tour

The studio sidebar groups the tabs (tab ids live once in `app/features/shell/tabs.ts`):

| Group | Tab | What it does |
| --- | --- | --- |
| Hiring | Overview / Pipeline | Kanban board of candidates across hiring stages, scheduler control, candidate drawer; the overview surfaces what needs a human decision first |
| Hiring | Channels | Sourcing channels feeding the pipeline |
| Hiring | Decisions | AI screening recommendations, group eval, decision rules — all behind human review |
| Hiring | Schedule | Interview calendar, transcripts, prep kits |
| Hiring | Agents | The agent-candidate bridge ([agents/README.md](agents/README.md)) |
| Library | Jobs | Job postings table, ingest, publish, per-job candidates |
| Library | Job descriptions | JD library + template-driven JD builder |
| Tools | Profile | Candidate profile builder (archetype routing + completeness scoring) |
| Tools | Match | Rank the candidate pool against a job (KO filters + scoring + LLM reasoning) — now the candidate-focus mode of the Matrix |
| Tools | Analyze | The original CV/job-fit/salary analysis (multi-variant compare, history) |
| Tools | Interview sim | End-to-end pipeline simulation (Design JD → Source → Intake → Screen → Interview → Offer → Hired) with synthetic candidates |
| Tools | Assignments | Work-sample hiring — the module `dev_cases` / `/api/devcase` implements (below) |
| Insights | Analytics / Matrix / About | Decision log, candidate × JD pivot, methodology docs |
| Settings | Models, Billing, Branding, Integrations, Organization, Workspace | Provider keys, plans, white-label, calendar/ATS connections, members, workspace data |

Standalone pages outside the workspace shell:

- `/apply/[id]` — public, formless conversational apply portal (chat-based knockout questions).
- `/interview/[token]` — candidate-facing voice screening interview (consent, transcription notice, fixed provider per session).
- `/schedule/[token]` — candidate self-scheduling (pick a slot, get confirmation).
- `/offer/[token]` — candidate-facing offer accept/decline.
- `/status/[token]`, `/data/[token]` — candidate status transparency and data-held views ([compliance/README.md](compliance/README.md)).
- `/control` — autonomy control room: automation kill switch, pending human gates, lifecycle tracking, immutable audit trail, outcomes & calibration.
- `/interview-lab` — internal A/B harness comparing voice providers (ElevenLabs vs OpenAI Realtime) in Czech/English.
- `/diagrams` — live-rendered PlantUML architecture diagrams from `docs/diagrams/`.

**Dev-case hiring extension.** `pipeline/jobfit/devcase/` implements case-scenario
hiring that assumes 100% of candidate code is LLM-generated, so it grades durable
capabilities instead of lines of code: problem framing, tooling fluency,
judgment/verification, architecture, transfer. The lifecycle runs Need analysis →
Role + case design (with covert probes: ambiguity, legacy trap, verification trap,
underspecification) → Publish to channels → Submission intake (repo + commit
reflection) → Evaluation (reflection + tooling signal + rubric → transfer score) →
case-grounded interview brief. Design and evaluation use the Claude CLI with
deterministic fallbacks; an LLM-free policy pass auto-advances/rejects on rules with
fairness gates — early-career candidates are never silently auto-advanced or
auto-rejected. Full doc: [dev-case/README.md](dev-case/README.md).

**Voice interviews.** A recruiter (or the automation) creates an interview session;
the candidate opens `/interview/[token]`, consents, and talks to the agent.
Server-side, `app/_lib/voice/elevenlabs.ts` mints a signed URL for the
dashboard-free agent (browser connects via `@elevenlabs/react`); the OpenAI provider
mints ephemeral Realtime secrets instead. The interviewer asks 3–4 grounded questions
(per-candidate prompt overrides), the transcript is stored in `interview_sessions`,
and a scorecard is generated on completion. No feedback or decisions are given to
the candidate. Full doc: [interviews/README.md](interviews/README.md).

## One vocabulary along the thread

The core path — job description → assignment → evaluation → voice interview →
decision — crosses five modules that were each named by whoever built them, so the
same object arrived at the reader under a different word on every screen. That is
gap 7 of [`../ship/2026-08-28-one-thread.md`](../ship/2026-08-28-one-thread.md).

**The split is deliberate and it runs in one direction only: the schema and the API
keep the names they have, and the COPY converges.** A table name, a route segment,
a message-catalog namespace, a test id and a log line are identifiers — renaming one
costs a migration and buys nothing a reader can see. So the mapping below is a
translation layer, not a rename plan, and both columns are load-bearing: an agent
editing copy needs the left column, an agent editing code needs the right one.

| The user reads | The code says | Where |
| --- | --- | --- |
| **Job** — the opening a candidate is hired into | `jobs` table, id `jd-<slug>`, `/api/jobs`, `jobs.*` catalog | Jobs tab, job modal, board, matrix |
| **Job description** — the document that describes it | `jds` table (+ `jd_revisions`), `/api/jds`, `library.*` catalog | Job descriptions tab, JD builder, `/jds/[slug]` |
| **Role brief** — the structured intake behind a JD | `role_intakes` table, `RoleBrief` type, `/api/intake` | the role-intake dialog, and nowhere else |
| **Assignment** — the work sample | `dev_cases` / `dev_postings` / `dev_submissions`, `/api/devcase`, `devcase.*` catalog, `?tab=assignments` (legacy `?tab=dev`) | Assignments tab, detail, lifecycle strip, voice panel, Jobs lifecycle strip, Decisions |
| **Voice screen** — the AI interview | `interview_sessions`, `/api/interview` | Interview sim, board drawer, assignment detail |

Retired from user-facing copy, with what replaced each:

- **"case" / "dev case"** → *Assignment*. It survived in the lifecycle row, the empty
  ledger, the close dialog and the candidate work surface while the nav tab already
  said Assignments. Pinned by `devcase-vocabulary.test.ts` § "the ONE-NAME rule",
  which bans the word from the `devcase` / `devApply` / `about` / `palettePreview` /
  `setup` namespaces in `en` and asserts the three places that name the entity bare
  agree inside each locale.
- **"posting"** → *Job* where it named the `jobs` row (`Open the posting`, the job
  modal's first tab), *Channel* where it named a `dev_postings` row (which is an
  apply link on a channel, not an advertisement).

Known remaining synonyms, stated rather than quietly left:

- **"role"** is still used interchangeably with *Job* in `jobs.posting.*` ("Close
  role", "Role lifecycle") and in the pricing copy ("published roles"). It was left
  alone here because the sweep that fixes it also has to decide what happens to
  `roleFamily`, the role-intake dialog and the metered `job_posts` allowance — a
  bigger call than a copy pass.
- **"use case"** in `models.*` / `activity.*` / `analytics.*` names an LLM operation,
  not an assignment. It shares a word and nothing else; do not normalize it.
- The marketing tree (`landing.*`, `aboutPage.*`, `jobMarket.*`) and `legal.*` were
  left as they are — their claims are pinned by their own tests and their drift is
  tracked as gaps 14–15 of the same record.

### One status legend

Five status axes cross the same path (`jobs.status`, the 10-stage assignment
lifecycle, the workspace-composed board stages, `interview_sessions.status`,
`dev_submissions.status`). Each keeps its own labels — they name different things —
and each declares which of **five shared reading states** it is in:

| Tone | Means | Examples |
| --- | --- | --- |
| `neutral` | nothing has happened here yet | job `draft`, assignment `intake`, the board's entry column |
| `active` | the system is working; nobody is blocked | assignment `collecting`, interview `in_progress`, submission `received` |
| `waiting` | a **person** has to act | assignment `awaiting_approval`, interview `created` (candidate has not dialled), the board's offer column |
| `done` | it reached its successful end | assignment `promoted`, interview `completed`, submission `evaluated`, the board's terminal column |
| `stopped` | it ended without reaching it | job/assignment `closed`, interview `failed` / `revoked` |

The tables live in [`app/_lib/status-tone.ts`](../../app/_lib/status-tone.ts) (pure,
exhaustive per axis, each tuple pinned to its producer by `status-tone.test.ts`) and
are drawn by `StatusChip` / `StatusLegend` in
[`app/_components/StatusChip.tsx`](../../app/_components/StatusChip.tsx), which
extends the existing `Badge` primitive rather than duplicating it. Two rules worth
knowing before you extend it: the board axis is toned by stage **role**, never by
stage name, because board columns are workspace-editable; and `stopped` renders
muted, never red — a closed job is an outcome, not an error.

## Writing rules

- Name the **UI entry point**, the primary **user flows**, the **API/lib surface**, the
  **data model**, and a short **Known gaps** section. Nothing else.
- Cite real file paths and verify they exist. A doc that names a moved file is worse than
  no doc — that is the failure mode this tree was reorganized to fix.
- Long future-looking sections belong in `../concepts/`, not here.
- State it explicitly when a feature is gated behind a tier, an env key, or a dev flag,
  and describe what happens **without** API keys — keyless degradation is a product
  property of this app, not an edge case.
- Adding a feature area? Add its entry to
  [`scripts/docs/feature-doc-map.json`](../../scripts/docs/feature-doc-map.json) in the
  same change, or the drift detector will not watch it.
