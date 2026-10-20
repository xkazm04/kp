# Why `test:perf` is red on main — attribution and fix plan

**Charter:** `codebase-static-analysis-sweep` · **Date:** 2026-10-06 · **Measured at:** `9eee4b6d3`
**Base the ceilings were settled at:** `16ad0e337` (2026-09-24, `chore(perf): settle challenge-r09 wave-3 combined growth`)
**This run changed no code and no ceiling.** Everything below is a measurement.

## How this was measured

`perf-budget.json` is **byte-identical** between `16ad0e337` and `9eee4b6d3` (`git diff
16ad0e337..HEAD -- perf-budget.json` is empty), so every number here is tree growth, not a
ceiling that moved. 523 commits landed in that range.

- The base was exported with `git archive 16ad0e337 | tar -x -C <temp>` and measured by **that
  tree's own** `scripts/perf/check-budget.mjs --json`. No `checkout`, `stash` or worktree was
  taken in the repo.
- Base: **0 findings.** HEAD: **63 findings.** The gate was green at the moment it was settled.
- Every "after fixes" column and every "findings cleared" number below comes from applying the
  change in a `git archive HEAD` temp copy and re-running that copy's checker. None is estimated.

## The headline, stated first

**The route group's `+34..+40` is one edge, and it is named below. Removing it — and every other
avoidable edge this run could find — clears 0 of the 63 findings.**

That is not a reason to skip the fixes; it is the thing a fix plan has to say out loud, because a
plan that implied "fix the edge, gate goes green" would send the next run at a wall. The two
numbers are independent:

1. **There is a real, avoidable, high-leverage edge** on 25 route graphs: 24 modules / ~280 KB,
   introduced by one import in one hub module. It should be fixed on its own merits.
2. **The gate cannot return to green without ceiling raises**, because the budget was settled *at
   the measured value with ~0 headroom* and then 523 commits of genuine feature work landed while
   it was already red.

### Why there was no headroom to spend

At `16ad0e337`, the `app/api/**/route.ts` group's module distribution was bimodal — p50 = 49,
p95 = 230, max = 240 — and the ceiling was 231. Of 261 routes:

| module headroom at base (ceiling − measurement) | routes |
| --- | --- |
| 0–2 | **24** |
| 3–5 | 0 |
| 6–20 | 0 |
| > 20 | 237 |

Thirteen of those 24 had **exactly 0** modules of headroom; the widest had 2. On KB the same 24
had 6–14 KB of headroom against ~3130 KB measurements — 0.2%. The group's `why` field says this
was deliberate ("Settled … to the measured value (+2 KB slack)", repeatedly), and that is a
coherent ratchet discipline. Its cost is that **any** new shared edge, however legitimate, turns
24 routes red at once. That is what happened.

The compounding failure is a feedback loop, and it is the finding most worth acting on: the
house rule is that each builder raises its own measured share with a `why`. Once the gate was
already red, that rule stopped being reachable — a builder cannot tell its share from the
accumulated red — so 523 commits of growth landed with **no** `perf-budget.json` entry at all.
The budget file has not been touched since the day it went green.

## Finding group 1 — ~30 `app/api/**/route.ts` at 265–274 against ~231

**The culprit edge, with its module-set evidence.**

Three representative routes were diffed between base and HEAD. All three are **identical**:
+38 modules, −2 modules, net **+36**.

| route | base | now | Δ |
| --- | --- | --- | --- |
| `app/api/devcase/inbound/route.ts` | 229 | 265 | +36 |
| `app/api/tasks/[id]/route.ts` | 229 | 265 | +36 |
| `app/api/jobseeker/scan/route.ts` | 229 | 265 | +36 |

The 38 added modules are dominated by one cluster — `app/_lib/voice/*` (12 modules, including the
`voice/index.ts` barrel), `interview-kit*` (5), `interview-*` (7), `db/intakes`,
`db/interview-kits`. Shortest path at HEAD:

```
app/api/tasks/[id]/route.ts
  -> app/_lib/tasks.ts
  -> app/_lib/automation-run.ts
  -> app/_lib/interview-scorecard-commit.ts     <-- the edge
  -> app/_lib/interview-run.ts
  -> app/_lib/voice/index.ts                    (+ interview-agenda -> interview-kit.ts)
```

At base, `app/_lib/automation-run.ts` was **already** on every one of these graphs, and
`interview-scorecard-commit.ts`, `interview-run.ts` and `voice/index.ts` were **NOT REACHABLE**
from any of them. The whole cluster arrived through a single new import.

**The import edge and its introducing commit.**

`git diff 16ad0e337..HEAD -- app/_lib/automation-run.ts` adds exactly two value imports:

| edge | introducing commit | cost |
| --- | --- | --- |
| `automation-run.ts` → `./interview-scorecard-commit` (`scorecardGateOpen`) | **`a474100ec`** `feat(interview-scoring): commit voice scorecard attach, gate check and approval atomically` | **24 modules / ~280 KB** on 25 route graphs |
| `automation-run.ts` → `./archetype-live` (`readLiveArchetypes`) | **`0faded607`** `fix(automation): the screening auto gate never ratifies a fairness-shielded candidate` | 4 modules / ~37 KB |

The remaining +8..12 is dispersed legitimate growth (see group 1b).

**Why it is avoidable, and the smallest change that removes it.**

`scorecardGateOpen` (`app/_lib/interview-scorecard-commit.ts:27`) is a **pure predicate**. Its
only dependency is `stageHasRole` / `DEFAULT_STAGE_AXIS` / `StageDef` from `./pipeline-stages` —
already on every one of these graphs. It happens to live in a module that also hosts
`commitCandidateScorecard`, which imports the whole voice/interview-kit layer. It has exactly
**one** non-test importer (`automation-run.ts:25`).

There is also a **cycle**: `interview-scorecard-commit.ts:8` imports `automation-run.ts`, which
now imports `interview-scorecard-commit.ts`. That cycle is why the cluster became reachable from
anything that touches the task hub at all.

This is the "move a helper into a leaf module" case named in the header of
`scripts/perf/check-budget.mjs` and in `docs/architecture/app-structure.md`.

**Fix A (measured).** New leaf `app/_lib/interview-scorecard-gate.ts` holds `scorecardGateOpen`;
`automation-run.ts` imports it from there; `interview-scorecard-commit.ts` re-exports it so
`interview-scorecard-commit.test.ts` (6 assertions on it) stays green unchanged.

> Measured on a temp copy of HEAD: route graphs **265 → 241** modules, **3590 → 3310** KB.
> **Findings cleared: 0** (241 is still over the 231 ceiling).

### Group 1b — the residual +12, after Fix A

Diffing the fixed tree against base leaves 12 added modules on `app/api/tasks/[id]/route.ts`, and
they are **dispersed, not one edge** — each is a separate shipped feature:

| module | KB | reached via | verdict |
| --- | --- | --- | --- |
| `app/_lib/archetype-live.ts` + `archetype-registry.ts` | 6 + 22 | `automation-run` (`0faded607`) | fairness shield — legitimate |
| `app/features/shared/profileTypes.ts` + `taxonomy.generated.ts` | 8 + 1 | `archetype-registry` | **avoidable — Fix B** |
| `app/_lib/auth/session-revocation.ts` | 13 | `auth/current-user.ts` (`04b459639`) | per-session revocation — legitimate |
| `app/_lib/db/add-columns.ts` | 4 | `db/core.ts` (`5ef013f51`) | legitimate (see group 3) |
| `app/_lib/db/org-benchmarks.ts` | 11 | `devcase-orchestrator` → `comms.ts` | legitimate |
| `app/_lib/devcase-cohort-rank.ts` | 6 | `devcase-orchestrator` | legitimate |
| `app/_lib/llm-pins.ts` | 3 | `llm-config.ts` (`d78963a42`) | legitimate (see group 3) |
| `app/_lib/outreach-body.ts` + `text-sanitize.ts` | 2 + 3 | `comms.ts` | legitimate |

**Fix B (measured).** `app/_lib/archetype-registry.ts:9` value-imports
`@/app/features/shared/profileTypes` for **one 3-element literal**, `BUILT_IN_ARCHETYPE_IDS`. A
`_lib` module reaching into `app/features/` is a layering inversion as well as a cost: it drags
`profileTypes.ts` (8 KB) and `taxonomy.generated.ts` onto every server graph. Move the literal to
the `_lib` leaf that already owns archetype vocabulary (`app/_lib/archetypes.ts`), keep
`ArchetypeChecklistItem` as `import type` (free), and re-export from `profileTypes.ts` so
`ArchetypeManager.tsx` is untouched.

> Measured stacked on Fix A: route graphs **241 → 239** modules, **3310 → 3301** KB.
> **Findings cleared: 0.**

### Group 1c — five routes that are new since base

`app/api/gigs/{[id]/plans,[id]/proposal,[id]/report,plans,scan}/route.ts` did not exist at
`16ad0e337` and arrive at **265–270** modules against the 231 group ceiling. This is the group
ceiling doing exactly the job its `why` claims ("a new route arriving over the group ceiling
fails without anyone having added it here first") — it caught them, and nobody recorded them,
because the gate was already red. They are legitimate new surfaces and need overrides, not
surgery.

### Group 1 attribution table

| entry | base mod | now mod | after A+B | ceil mod | base KB | now KB | after A+B | ceil KB | culprit edge | commit | fix or record |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `app/api/agents/hire-from-need/route.ts` | 240 | 274 | 250 | 240 | 3213 | 3659 | 3398 | 3219 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/gigs/[id]/proposal/route.ts` | new | 270 | 244 | 231 | new | 3671 | 3382 | 3132 | new route | `a4bd47af3` | record (override) |
| `app/api/decisions/feedback-letters/[id]/redraft/route.ts` | 233 | 269 | 243 | 233 | 3151 | 3624 | 3336 | 3157 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/devcase/lifecycle/[id]/approve/route.ts` | 234 | 269 | 244 | 234 | 3147 | 3620 | 3332 | 3153 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/gigs/[id]/plans/route.ts` | new | 269 | 243 | 231 | new | 3676 | 3388 | 3132 | new route | `73157dacf` | record (override) |
| `app/api/gigs/[id]/report/route.ts` | new | 269 | 243 | 231 | new | 3669 | 3381 | 3132 | new route | `712d5b0c9` | record (override) |
| `app/api/intake/[id]/promote/route.ts` | 232 | 269 | 245 | 232 | 3152 | 3626 | 3365 | 3158 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/status/[token]/letter/route.ts` | 233 | 269 | 243 | 233 | 3161 | 3631 | 3343 | 3167 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/devcase/lifecycle/route.ts` | 232 | 268 | 242 | 232 | 3134 | 3606 | 3317 | 3140 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/tasks/[id]/retry/route.ts` | 232 | 268 | 242 | 232 | 3144 | 3617 | 3328 | 3151 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/tasks/route.ts` | 232 | 268 | 242 | 232 | 3145 | 3617 | 3329 | 3151 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/analyze/route.ts` | 231 | 267 | 241 | 231 | 3141 | 3612 | 3323 | 3148 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/gigs/scan/route.ts` | new | 267 | 241 | 231 | new | 3636 | 3347 | 3132 | new route | `709b791c1` | record (override) |
| `app/api/tasks/history/route.ts` | 231 | 267 | 241 | 231 | 3133 | 3604 | 3316 | 3139 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/companion/[id]/message/route.ts` | 230 | 266 | 240 | 231 | 3126 | 3599 | 3310 | 3132 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/companion/proposals/[id]/resolve/route.ts` | 230 | 266 | 240 | 231 | 3125 | 3598 | 3309 | 3132 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/devcase/control/route.ts` | 230 | 266 | 240 | 231 | 3133 | 3607 | 3318 | 3139 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/devcase/session/[id]/submit/route.ts` | 231 | 266 | 241 | 231 | 3133 | 3603 | 3315 | 3140 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/jds/[slug]/retry-analysis/route.ts` | 230 | 266 | 240 | 231 | 3134 | 3607 | 3319 | 3140 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/jds/generate/route.ts` | 230 | 266 | 240 | 230 | 3136 | 3610 | 3321 | 3143 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/jobs/[id]/interview-kit/route.ts` | 232 | 266 | 242 | 232 | 3150 | 3609 | 3335 | 3157 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/repo-scan/[id]/route.ts` | 230 | 266 | 240 | 231 | 3124 | 3597 | 3309 | 3132 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/repo-scan/route.ts` | 230 | 266 | 240 | 231 | 3126 | 3599 | 3310 | 3132 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/devcase/inbound/route.ts` | 229 | 265 | 239 | 231 | 3123 | 3594 | 3305 | 3132 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/devcase/submit/route.ts` | 229 | 265 | 239 | 231 | 3120 | 3594 | 3305 | 3132 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/gigs/plans/route.ts` | new | 265 | 239 | 231 | new | 3593 | 3304 | 3132 | new route | `73157dacf` | record (override) |
| `app/api/jobs/[id]/agent-fit/route.ts` | 229 | 265 | 239 | 231 | 3120 | 3593 | 3305 | 3132 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/jobseeker/scan/route.ts` | 229 | 265 | 239 | 231 | 3119 | 3592 | 3303 | 3132 | scorecard-gate | `a474100ec` | A, then record |
| `app/api/tasks/[id]/route.ts` | 229 | 265 | 239 | 231 | 3118 | 3590 | 3301 | 3132 | scorecard-gate | `a474100ec` | A, then record |

## Finding group 2 — `app/page.tsx` at 1802 / 11004 against 1455 / 9294

Commit-by-commit measurement along `git rev-list --reverse` is **not** reliable here: the range
contains merges, so the sampled series is non-monotone (it reads 1633, then 1554) because
consecutive entries sit on different branches. Attribution was done structurally instead — diff
the module set, then ask `git log --diff-filter=A` which commit created each newly-reachable
file. That is order-independent.

```
app/page.tsx: base 1455 mod / 9280 KB  ->  head 1802 mod / 11004 KB
added 460 modules, removed 113
KB from NEW modules:       +2280
KB from modules that GREW:   +56
KB from REMOVED modules:    -613
```

Note the shape: the KB overrun is almost entirely **new modules**, not existing files growing.
This page is being extended with surfaces, not bloated in place. The 113 removed modules / −613 KB
are the old views the kit ports deleted, which is the ratchet working.

### Legitimate growth — record with a why

| Δ modules | ~KB | commit | surface |
| --- | --- | --- | --- |
| +160 | 836 | `84fa0c95e` 2026-10-05 `feat: commit the in-progress kit/scene, channels night, landing and atlas work so main builds` | `_components/kit/scene/*` (20), `hiring/channels/night/*`, landing/atlas |
| +83 | 351 | `a4bd47af3` 2026-09-29 `feat(gigs): proof tabs sit in the trail…` | the Gigs desk |
| +25 | 94 | `36669710a` 2026-09-25 `feat(kit): the everyday composition-kit parts and kit.css` | composition kit |
| +19 | 210 | `ce89502e4` 2026-10-01 `feat(agents): Hiring > Agents is the Time-Card Rack` | agents-workforce |
| +18 | 68 | `cc8168a6d` 2026-09-25 `feat(kit): the graphic layer` | kit graphic layer |
| +18 | 72 | `e11505681` 2026-09-25 `feat(journeys): rebuild the Journeys board as the kit's lane board` | journeys |
| +17 | 129 | `023bc26c2` 2026-09-28 `feat(pipeline): the Orbit replaces the roles board` | pipeline Orbit |
| +8 each | 33–42 | `73157dacf`, `7840509b7`, `fd59b3b35` | gigs Plans/Workbench, Decisions Docket |
| +1..7 | — | ~40 further commits | ordinary per-feature growth |

`84fa0c95e` alone is 46% of the module growth. It is the WIP-baseline commit that landed the
Channels "Night Post" and Overview "Orbit, Lit" ports plus the `kit/scene` layer — work that was
sitting uncommitted. Two checks were made on it and both come back **legitimate**:

- **No double implementation.** `ChannelsTab.tsx` is three lines rendering `ChannelsNightShell`;
  its header records that the kit view and the setup cards it replaced were deleted. The 113
  removed modules are those old views.
- **The `kit/scene` barrel is not leaking.** `app/_components/kit/scene/index.ts` is a barrel with
  20 value importers, but every importer is inside the two surfaces that use the scene layer
  (`agents-workforce/*`, `channels/night/*`), and both are already fully on `page.tsx`'s graph.
  De-barrelling it would move `page.tsx` by 0. Worth keeping an eye on if a third surface reaches
  for it from a lighter graph, but it is not today's cost.

### Avoidable edge — owner decision, not a builder's

`app/features/insights/journey/JourneyOverlay.tsx:41` mounts a **dev-only** kit port:

```js
const JourneyKitView = dynamic(() => import("./kit/JourneyKitView"), { … });
const kit = useKitFlag();   // app/_components/kit/useKitFlag.ts: returns false in production
```

`useKitFlag` is explicitly `?kit=1`-only and "Production builds always render the current
surface". Its own header states the promotion rule: "a promoted surface stops calling it and
deletes its old view". Journeys is the one surface that still calls it, so `page.tsx` carries
both the current board and a port that production never renders.

> Measured on a temp copy of HEAD with that edge cut: `page.tsx` **1802 → 1761** modules,
> **11004 → 10853** KB — the port costs **41 modules / 151 KB**. **Findings cleared: 0.**

This is the one place where graph surgery and a product decision are the same decision, and it is
not a builder's to make: deleting the port ends an evaluation the owner is still running. Raised
as a question below rather than recommended as a fix.

## Finding group 3 — `app/_lib/llm-config.ts` and `app/_lib/job-ingest.ts`

Both hubs tell the same, clean story, and neither has an avoidable edge.

| entry | base | now | ceiling | new modules | from in-place growth |
| --- | --- | --- | --- | --- | --- |
| `app/_lib/llm-config.ts` | 16 mod / 330 KB | 18 mod / **361 KB** | 19 mod / 330 KB | +8 KB | **+23 KB** |
| `app/_lib/job-ingest.ts` | 27 mod / 423 KB | **29** mod / **458 KB** | 28 mod / 423 KB | +8 KB | **+27 KB** |

Both gained **exactly the same two modules**:

| module | KB | commit | verdict |
| --- | --- | --- | --- |
| `app/_lib/db/add-columns.ts` | 4 | `5ef013f51` 2026-09-24 | **record.** One additive-column migrator replacing a per-store `ADD COLUMN` wrapped in `catch { /* column already exists */ }` that also swallowed `SQLITE_READONLY`/`FULL`/`IOERR`/`CORRUPT`/`BUSY`. It is a correctness fix of exactly the kind `.claude/CLAUDE.md`'s empty-catch rule exists to force; inlining it back into each store is strictly worse. |
| `app/_lib/llm-pins.ts` | 3 | `d78963a42` 2026-09-28 | **record.** A 3 KB leaf letting a call site pin its engine. |

`llm-config.ts` is at 18 modules against a ceiling of 19 — **only its KB fails**. Most of the KB
on both (+23 and +27) is **in-place growth of modules already on the path**, principally
`app/_lib/db/core.ts` (193812 → 210084 bytes, +16 KB), which sits on every graph that reaches the
DB layer. No import can be removed to recover that. Both are pure ceiling raises.

## Recommended order — three commits

Fix A and Fix B were both measured stacked; the ceiling commit's numbers below are the
post-fix measurements, so this order is the one that does not have to be re-measured twice.

### Commit 1 — `refactor(perf): the scorecard gate predicate moves to a leaf module`

Breaks the `automation-run` ↔ `interview-scorecard-commit` cycle and takes **24 modules /
~280 KB off 25 route graphs**. Highest leverage available, and worth doing for the cycle alone.

Files edited:
- `app/_lib/interview-scorecard-gate.ts` *(new)* — `scorecardGateOpen`, importing only `./pipeline-stages`
- `app/_lib/automation-run.ts` — line 25 imports from `./interview-scorecard-gate`
- `app/_lib/interview-scorecard-commit.ts` — drops the definition (lines 27–34), imports and re-exports it from the leaf

`app/_lib/interview-scorecard-commit.test.ts` imports `scorecardGateOpen` from
`interview-scorecard-commit`; the re-export keeps its 6 assertions green with no test edit.

### Commit 2 — `refactor(perf): archetype-registry reads the built-in ids from a _lib leaf`

Removes a `_lib` → `app/features/` value edge. −2 modules / ~−9 KB on the same 25 graphs; the
layering is the real win.

Files edited:
- `app/_lib/archetypes.ts` — gains `BUILT_IN_ARCHETYPE_IDS`
- `app/_lib/archetype-registry.ts` — line 9 splits into a value import from `./archetypes` and an `import type` for `ArchetypeChecklistItem`
- `app/features/shared/profileTypes.ts` — line 35 becomes a re-export, so `ArchetypeManager.tsx` is untouched

*(Alternative, one file fewer: point `ArchetypeManager.tsx:6` at `@/app/_lib/archetypes` and drop
the literal from `profileTypes.ts`. Same graph result; the re-export was chosen as measured.)*

### Commit 3 — `chore(perf): settle 523 commits of recorded growth`

The only file: **`perf-budget.json`**. This is the commit that returns `test:perf` to green, and
it must land *after* 1 and 2 so it records the post-fix numbers rather than buying headroom for an
edge that is about to go. Every raise below is a measured value; the `why` prose for each is in
this document's group sections, and the house format ("Raised X → Y on <date> because …, measured
as that change's files alone") should cite this file by path.

**It must not be written as one wide group raise.** The group ceiling protects 237 routes that
still sit >20 modules under it; moving 231 → 250 would silently licence +19 on all of them. The
heavy cluster takes named overrides — the mechanism `--record` already uses and the group's own
`why` already appeals to ("larger routes have named overrides"). That grows the override list
from 15 to ~30, which is the honest shape of this tree.

## The ceiling raises that remain after commits 1 and 2

Measured on a temp copy of HEAD with Fix A and Fix B applied. Module ceilings are the
measurement; KB ceilings are the measurement + the 2 KB the group's `why` has used as house slack.

| entry | modules | KB |
| --- | --- | --- |
| `app/page.tsx` | 1455 → **1761** | 9294 → **10855** |
| `app/_lib/llm-config.ts` | unchanged (18 of 19) | 330 → **363** |
| `app/_lib/job-ingest.ts` | 28 → **29** | 423 → **460** |
| `app/api/agents/hire-from-need/route.ts` | 240 → **250** | 3219 → **3400** |
| `app/api/intake/[id]/promote/route.ts` | 232 → **245** | 3158 → **3367** |
| `app/api/devcase/lifecycle/[id]/approve/route.ts` | 234 → **244** | 3153 → **3334** |
| `app/api/gigs/[id]/proposal/route.ts` | 231 → **244** | 3132 → **3384** |
| `app/api/gigs/[id]/plans/route.ts` | 231 → **243** | 3132 → **3390** |
| `app/api/gigs/[id]/report/route.ts` | 231 → **243** | 3132 → **3383** |
| `app/api/decisions/feedback-letters/[id]/redraft/route.ts` | 233 → **243** | 3157 → **3338** |
| `app/api/status/[token]/letter/route.ts` | 233 → **243** | 3167 → **3345** |
| `app/api/devcase/lifecycle/route.ts` | 232 → **242** | 3140 → **3319** |
| `app/api/jobs/[id]/interview-kit/route.ts` | 232 → **242** | 3157 → **3337** |
| `app/api/tasks/[id]/retry/route.ts` | 232 → **242** | 3151 → **3330** |
| `app/api/tasks/route.ts` | 232 → **242** | 3151 → **3331** |
| `app/api/analyze/route.ts` | 231 → **241** | 3148 → **3325** |
| `app/api/devcase/session/[id]/submit/route.ts` | 231 → **241** | 3140 → **3317** |
| `app/api/gigs/scan/route.ts` | 231 → **241** | 3132 → **3349** |
| `app/api/tasks/history/route.ts` | 231 → **241** | 3139 → **3318** |
| `app/api/companion/[id]/message/route.ts` | 231 → **240** | 3132 → **3312** |
| `app/api/companion/proposals/[id]/resolve/route.ts` | 231 → **240** | 3132 → **3311** |
| `app/api/devcase/control/route.ts` | 231 → **240** | 3139 → **3320** |
| `app/api/jds/[slug]/retry-analysis/route.ts` | 231 → **240** | 3140 → **3321** |
| `app/api/jds/generate/route.ts` | 230 → **240** | 3143 → **3323** |
| `app/api/repo-scan/[id]/route.ts` | 231 → **240** | 3132 → **3311** |
| `app/api/repo-scan/route.ts` | 231 → **240** | 3132 → **3312** |
| `app/api/devcase/inbound/route.ts` | 231 → **239** | 3132 → **3307** |
| `app/api/devcase/submit/route.ts` | 231 → **239** | 3132 → **3307** |
| `app/api/gigs/plans/route.ts` | 231 → **239** | 3132 → **3306** |
| `app/api/jobs/[id]/agent-fit/route.ts` | 231 → **239** | 3132 → **3307** |
| `app/api/jobseeker/scan/route.ts` | 231 → **239** | 3132 → **3305** |
| `app/api/tasks/[id]/route.ts` | 231 → **239** | 3132 → **3303** |

If the owner also retires the Journeys kit port (see the question below), `app/page.tsx` settles
at **1761 / 10853** either way — the 41 modules / 151 KB that change saves are already excluded
from the 1761 above, because that measurement was taken with the edge cut. **A raise to
1802 / 11006 is what is needed if the port stays.** That is the one number in this table that
depends on a decision rather than a measurement.

## Questions for the operator

1. **The Journeys kit port.** `JourneyOverlay.tsx` is the last caller of `useKitFlag`, and the
   flag's own contract says a promoted surface deletes its old view. The port costs `page.tsx`
   41 modules / 151 KB that production never renders. Is the Journeys kit evaluation still open?
   If it is closed, retiring the losing view is a 1-file change worth 41 modules; if it is open,
   the `page.tsx` ceiling should be raised to 1802 / 11006 instead of 1761 / 10855.
2. **The zero-headroom ratchet.** The budget's settle-to-measured-value discipline means a single
   new shared edge turns 24 routes red simultaneously, and once red the per-builder "record your
   own share" rule becomes unusable — which is how 523 commits landed with no budget entry at all.
   Consider whether the heavy cluster should carry overrides with a few modules of deliberate
   headroom, so one legitimate edge produces one finding to record rather than 24 to triage.
3. **`test:perf` as a reviewer signal.** Until commit 3 lands, this gate tells a reviewer nothing
   about a new change. If commit 3 slips, it is worth deciding explicitly whether the gate stays
   red or is temporarily non-blocking, rather than leaving it red by default.

## Reproducing this

```bash
# base, in a temp dir outside the repo
git archive 16ad0e337 | tar -x -C "$TMP/base"
( cd "$TMP/base" && node scripts/perf/check-budget.mjs --json )   # 0 findings

# head
node scripts/perf/check-budget.mjs --json                          # 63 findings
node scripts/perf/check-budget.mjs --explain app/api/tasks/\[id\]/route.ts

# the culprit edge, in one command
git diff 16ad0e337..HEAD -- app/_lib/automation-run.ts | grep -E '^\+import'
git log --oneline -S'from "./interview-scorecard-commit"' 16ad0e337..HEAD -- app/_lib/automation-run.ts
```
