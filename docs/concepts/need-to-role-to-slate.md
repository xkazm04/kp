# Need → role → slate — the breakdown

Status: **design; increments 1 and 2 built** (2026-09-14) — the `RubricAxis`
shape + deterministic derivation and the `role_rubrics` store. Where the as-built
shape differs from the sketches below, the code and
[`docs/features/intake/README.md`](../features/intake/README.md#role-rubric-store-role_rubrics)
are authoritative. The decision this enacts is
[ADR 0012](../architecture/decisions/0012-need-role-slate-one-board.md); the
need→role leg it builds on is [`role-intake-dialog.md`](role-intake-dialog.md).
Goal served: *Hire-from-need composes a role from a stated need — a stated need
becomes a role, the role becomes a candidate slate (an AI agent or a person),
on the same board with the same evaluation.*

## The chain, and what of it exists

```
 stated need            role                       slate
 ──────────             ────                       ─────
 role_intakes  ──promote──▶ jds + jobs  ──────▶ pipeline_entries WHERE job_id = ?
 (RoleBrief:                (JD prose +          ├─ population: human  (a person)
  graded reqs,               JobRecord)          └─ population: agent  (an AI agent)
  facets,                        │                        ▲
  provenance)                    │                        │
      SHIPPED                    └── role_rubrics ────────┘ one frozen, weighted
                                     (NEW, frozen            axis list; one score;
                                      at promotion)          two evidence adapters
```

| Leg | State today | Gap |
| --- | --- | --- |
| need → brief | shipped (`app/_lib/db/intakes.ts`, `/api/intake/*`) | — |
| brief → role | shipped (`/api/intake/[id]/promote` → `jd_build` → `Job`) | rubric is not derived here |
| role → human slate | shipped (`pipeline_entries`, `match_score`) | no rubric, no population |
| role → agent slate | shipped but off-board (`agent_fit_specs` → `hired_agents`, Agents workforce tab) | never becomes a slate member |
| one evaluation | **absent** | three implicit rubrics, none from the brief |

## Schema changes

All of it is additive; no persisted field changes meaning; no backfill.

**New store — `app/_lib/db/role-rubrics.ts`** (owns its own DDL, the house
convention for a new table: see the note at the top of `db/agents.ts`):

```
role_rubrics
  id TEXT PRIMARY KEY
  workspace_id TEXT NOT NULL          -- tenancy manifest: needs role-rubrics-tenancy.test.ts
  job_id TEXT NOT NULL
  intake_id TEXT                      -- the brief it was derived from, when there was one
  version INTEGER NOT NULL            -- (job_id, version) unique; freeze is append-only
  axes_json TEXT NOT NULL             -- RubricAxis[]
  source TEXT NOT NULL                -- 'brief' | 'job' | 'manual'  (how it was derived)
  created_at TEXT NOT NULL
  frozen_at TEXT                      -- set when the first candidate is scored against it
```

As built: the UNIQUE is `(workspace_id, job_id, version)` — a shared-corpus job has a
NULL workspace in `jobs`, so two teams each number their own versions — and a
`BEFORE UPDATE` trigger makes every column but a once-only `frozen_at` immutable.

`RubricAxis` (Pydantic-authoritative in `pipeline/jobfit/`, codegen'd to Zod
like `RoleBrief` — the brief's graded requirements are the input, so the shape
belongs next to them):

```
{ key, label, weight,                       -- weight from kind × hardness
  origin: 'requirement' | 'facet' | 'cost', -- what in the brief produced it
  requirementRef?, facetKey?,
  humanEvidence: 'analysis' | 'scorecard' | 'devcase' | 'salary_band',
  agentEvidence:  'agent_fit' | 'trial_run' | 'mandate_exchange' | 'budget' }
```

As built (`pipeline/jobfit/rolerubric.py`): no `requirementRef`/`facetKey` — the axis
`key` carries its origin (`req:<skill>`, `facet:<name>`, `cost:budget_band`) — and the
axis also records `kind`, `hardness`, `blocking`, `provenance`, `rationale` and the
`evidenceClass` (ADR-0012 §3's row) its two evidence sources are taken from.

**Two columns on `pipeline_entries`** (added by the pipeline store, not
`core.ts`, same one-owner-per-table reason):

```
population TEXT NOT NULL DEFAULT 'human'   -- 'human' | 'agent'
agent_ref  TEXT                            -- agent_fit_specs.id, NULL for people
rubric_score INTEGER                       -- NULL is honest; never 0 (match-score.ts policy)
rubric_version INTEGER                     -- which frozen rubric produced it
rubric_basis_json TEXT                     -- [{axis, score, source, evidenceRef}] — explainability
```

## API endpoints

| Method + path | Purpose | Gates |
| --- | --- | --- |
| `POST /api/jobs/[id]/rubric` | derive + freeze a rubric version from the job's brief (or from the job when there is no intake) | operator, workspace, rate-limit entry |
| `GET /api/jobs/[id]/rubric` | current version + axes, for the board and the drawer | operator, workspace |
| `POST /api/jobs/[id]/slate` | compose/refresh the slate: ensure an entry per agent-fit spec alongside existing human entries; idempotent by `(job_id, agent_ref)` | operator, workspace, rate-limit entry |
| `POST /api/pipeline/[id]/score` | score one entry against the frozen rubric via its population's evidence adapter | operator, workspace, rate-limit entry |

Existing routes that change behaviour rather than shape:

- `POST /api/intake/[id]/promote` — also derives rubric v1 for the produced job.
- `POST /api/agents/hire-from-need` — lands a slate entry on its way through;
  the dispatch tail stays the same call it is today.
- `POST /api/agents/dispatch` — requires a slate entry standing on a
  `terminal`-role stage with its human approval recorded.

Every new route needs a line in `app/api/rate-limit-contract.test.ts` and
`app/api/route-tenancy-coverage.test.ts` — those contracts are gates, not
suggestions (ADR 0007).

## UI touchpoints

- `PipelineBoardToolbar.tsx` — a population filter (People · Agents · Both);
  default Both once the first agent entry exists, People before that, so an
  all-human board is unchanged.
- `PipelineCandidateRow.tsx` — a population chip; the rubric score beside the
  match score, em dash when null (`ScoreBadge`'s existing honesty).
- `PipelineCandidateDrawer.tsx` — a rubric panel: one row per axis with the
  score, the weight and the *basis* link to the artifact that produced it.
  This panel is also the deliverable for the *"every automated step is
  explainable to the candidate"* goal.
- `pipelineBoardPopulation.ts` — `boardPopulation` gains the population split;
  the header counts and the Today rail must each say which population they
  mean.
- Library/JD detail — the frozen rubric, its version, and a staleness chip
  when the JD was edited after the freeze (reuse the `jdLastEditedAt`
  mechanism).
- `app/features/agents-workforce/AgentsWorkforceTab.tsx` — reframed as the
  post-hire roster; its "hire" affordance becomes "add to slate".
- i18n: 4-locale parity on every new string; both themes verified. House law.

## Increments

Sized to one Dev Clone pass (20-minute hard cap), vertically sliced, and
file-disjoint where they run in parallel.

| # | Increment | Touches | Parallel with | Risk · Effort · Impact |
| --- | --- | --- | --- | --- |
| 1 | `RubricAxis` schema + deterministic derivation from a RoleBrief, unit-tested keyless | `pipeline/jobfit/rolerubric.py`, `app/_lib/role-rubric.ts`, tests | 2 | 2 · 2 · 4 |
| 2 | `role_rubrics` store + tenancy test (real migration, not an inline schema) | `app/_lib/db/role-rubrics.ts` (+ tenancy test) | 1, 3 | 2 · 2 · 3 |
| 3 | `population` + `agent_ref` columns on `pipeline_entries`, read/write through the store, board reads unchanged | `app/_lib/db/pipeline*.ts`, `pipelineTypes.ts` | 1, 2 | 3 · 2 · 4 |
| 4 | `GET`/`POST /api/jobs/[id]/rubric` + contract-test entries; promote derives v1 | `app/api/jobs/[id]/rubric/*`, promote route | — (needs 1+2 merged) | 3 · 2 · 4 |
| 5 | Scoring resolver + the two evidence adapters; null-honest, basis-carrying | `app/_lib/rubric-score.ts` (+ adapters, tests) | 6 (needs 1+3) | 2 · 3 · 5 |
| 6 | `POST /api/jobs/[id]/slate` — idempotent agent-entry composition | `app/api/jobs/[id]/slate/*` | 5 (needs 3) | 3 · 2 · 4 |
| 7 | Board UI: population chip + filter + rubric column | `PipelineBoardToolbar`, `PipelineCandidateRow`, `pipelineBoardPopulation` | 8 (needs 3) | 2 · 3 · 3 |
| 8 | Drawer rubric panel with per-axis basis links (the explainability surface) | `PipelineCandidateDrawer*`, i18n | 7 (needs 5) | 2 · 3 · 4 |
| 9 | Comms refuses an agent-population recipient with a stated reason | `comms-recipient.ts`, `comms-dispatch.ts`, tests | any | 2 · 1 · 3 |

Sequencing rule (repo standard — never build on an unmerged PR): 1, 2, 3 and 9
are independent and can run concurrently on day one; 4 and 6 start when their
store increments are on `main`; 5 starts when 1 and 3 are on `main`; 7 and 8
are last.

## The checklist that proves it done

The goal is measured by a number, not by a description of work, so the
back-measure is named up front:

1. One job, composed from an intake, carries a frozen rubric v1 whose axes are
   traceable to the brief's stated requirements.
2. That job's board shows at least one `human` and one `agent` entry.
3. Both carry a `rubric_score` computed from the *same* axis list, and each
   axis score names the artifact it came from.
4. A keyless run produces the same rubric and an honest `null` for an
   unassessed agent — no fabricated zero.
5. No existing all-human board changes its counts, its fairness metric, or its
   sealed decisions as a result of the population column.
