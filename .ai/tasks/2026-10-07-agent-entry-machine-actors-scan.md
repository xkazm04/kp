---
kind: task
status: done
opened: 2026-10-07
charter: codebase-security-scan
branch: autopilot/codebase-security-scan-da03f24f
gate: npm run test:unit -- 'app/_lib/auth/**/*.test.ts' 'app/api/**/*.test.ts'
measurable: machine actors that act on an agent-population pipeline entry as if it were a person. Found 8 (3 unsafe, 4 unclear/low, 1 root cause). Report-only — no source changed.
---

# Which machine actors treat an AI agent on the role board as a person

Report-only scan of the two agent-shaped pipeline entries 2c95aba47 and its
predecessors put on the role board. Nothing in `app/`, `scripts/`, `docs/` or
`pipeline/` was touched.

**Reconcile first.** `git log 2c95aba47..main` is **empty** — 2c95aba47 is the
local `main` tip and the base of this branch. No commit after it guards any actor
and none files the dispatch card with `population: 'agent'`, so the scan is not
narrowed. Every finding below stands against the current tree.

## The two entries

| | agent-fit entry | dispatch card |
| --- | --- | --- |
| writer | `persistAgentFit`, `app/_lib/agent-hire/transform-run.ts:87` | `placeAgentOnBoard`, `app/_lib/agent-hire/lifecycle.ts:79` |
| `candidateId` | `agent-fit-<jobId>` | `agent-<agentId>` |
| `candidateLabel` | `envelope.result.spec.name` — **LLM output** | `opts.label` (= `input.spec.name`, LLM output, at `app/api/agents/dispatch/mint.ts:161`) else `agent.personaName` (Personas) |
| `population` | `'agent'` (transform-run.ts:109) | **not set** → `coerceSlatePopulation(undefined)` = `'human'` (`app/_lib/db/core.ts:3491`) |
| `sourceChannel` | `agent-fit` | `agent-bridge` |
| lands at | default `screenedLandingStage` | `offer` role, then moved to `terminal` on activation |
| actor | `auto:agent-fit` | `auto:agent-bridge` |

The second row is the whole problem. `coerceSlatePopulation` maps every absent
value to `"human"` — it cannot distinguish "not set" from "a person" — so the
dispatch card is a person to every guard in the product, including the three that
already exist and work.

## The actor table

| actor | file:line | reads population | effect on the agent-fit entry | effect on the dispatch card | verdict | severity | key goal |
| --- | --- | --- | --- | --- | --- | --- | --- |
| role-fill arrival hook | `app/_lib/stage-hooks-role-fill.ts:81` (`runRoleFillHook`) | **no** | not terminal → `skipped: not_hire_role` | counts it as the role's hire, **retires the role** (`closeRoleIfOpen`) and **withdraws every in-flight human candidate** to `role_closed` (`closeEntriesByJobId`, `app/_lib/db/pipeline.ts:883`) | **unsafe** | **high** | **goal 3** |
| hire roster / Quality rating queue | `app/api/pipeline/outcomes/hire-roster.ts:37` (`listWorkspaceHires`) | **no** | not terminal → absent | counted in `hires`, queued as an **unrated hire** awaiting a 1–5 on-the-job performance rating (`app/_lib/hire-rating-queue.ts:82`) | **unsafe** | medium | goal 3 (score calibration) |
| analytics hire basis | `app/_lib/db/analytics.ts:476`, `:524`; `ROW_COLUMNS` at `:342` | **no** (the projection omits the column) | absent | inflates `hired`, `hiresClosedInWindow`, the time-to-hire sample, `costPerHireCzk` and the per-role funnel; feeds the metric pack's `measured`/certifiable rows | **unsafe** | medium | goal 3 |
| `placeAgentOnBoard` (the write) | `app/_lib/agent-hire/lifecycle.ts:87` | **no — it never sets it** | n/a | files an AI agent as `population='human'`; this is what makes rows 1–3 and 7–8 reachable | **unsafe** (root cause) | **high** | goal 3 |
| automation pass projection | `app/_lib/db/pipeline.ts:2968` (`listActiveEntriesForAutomation`) | **no — the column is not in the SELECT** | read as `population='human'`; any guard added downstream is a silent no-op | same | **unsafe** (latent trap) | medium | goal 3 |
| policy pass (`automation-pass.ts`) | `app/_lib/automation-pass.ts:588` → `pipeline/jobfit/automation.py:1016` | no | `hold` — "screened without a match score; awaiting match (not auto-rejected)"; never resolves (scoring is prefix-refused), so `stale_alert` then `aging_alert` fire forever (`automation.py:220`) | `hold` — "offer … awaiting response" + the same aging alerts | **unclear** (noise, not adverse) | low | goal 1 |
| pre-policy scoring sweep | `app/_lib/automation-pass.ts:296` → `candidate-pool.ts:119` | no — but refuses on the **`agent-` id prefix** | never scored, no spawn | never scored, no spawn | **safe** (by an explicit prefix guard) | — | goal 3 |
| `runAutomationTask` (screen / reject / offer / scorecard / rematch / outreach) | `app/_lib/automation-run.ts:373` | no — but `getProfileRecord` misses | refused `entry_has_no_profile` (400) before any LLM hop or write | same | **safe** (incidentally — no profile row exists) | — | goal 3 |
| `screen-wave.ts` | `app/_lib/screen-wave.ts:160` | no | **in the cohort** (stage `Screened`); unscored → excluded from `wouldReject`, listed as an `unscored` keep with its LLM-authored label; nothing written | not at `Screened` → absent | **safe** (null-score policy holds) | low | goal 3 |
| `screen-wave-approval.ts` | `app/_lib/screen-wave-approval.ts` | no | never in the signed set (unscored) | absent | **safe** | — | goal 3 |
| interview arrival hook | `app/_lib/stage-hooks.ts:262` | **yes**, via `entryContactability` | refused, but parked on the human `calendar` gate with the reason **"no deliverable contact address is on file"** — it appears in the Schedule docket "Awaiting link" | not refused (reads human); mint is then gated by contactability on the label, which is not an address → same park | **unclear** (wrong reason, manual step) | low | **goal 1** |
| homework arrival hook | `app/_lib/stage-hooks-homework.ts:161` | **yes**, via `entryContactability` | refused before publish, same `unaddressable` wording | same | **unclear** (wrong reason) | low | goal 1 |
| bulk schedule invite | `app/_lib/bulk-invite.ts:64`; route `app/api/schedule/invite/bulk/route.ts:112` | **yes** (`resolveCandidateRecipient` → `recipientRefusal`) | `SCHEDULE_BULK_UNADDRESSABLE`, no token minted | not refused by population; falls through to `unaddressable` because a persona name is not an email | **safe** | — | goal 3 |
| every candidate comm | `app/_lib/comms-dispatch.ts:345` (`sendCandidateComm` → `candidateRecipient` → `recipientRefusal`, `comms-recipient.ts:77`) | **yes** | refused as a `failed` outbox row naming the reason; **no erasure/opt-out tokens minted** | **not refused** — resolves to the label, mints GDPR erasure + opt-out capability tokens, writes an outbox row addressed to a persona name | **unsafe** for the card | medium | goal 3 |
| `dispatchInterviewInvite` via the status resend door | `app/_lib/candidate-next-action-server.ts:120` | **no — the object literal drops it** | population never reaches `recipientRefusal`; the refusal cannot fire | same | **unsafe** (broken seam) | low | goal 3 |
| offer-lapse reminder sweep | `app/_lib/offer-reminders.ts:19` | via `sendCandidateComm` | dormant (no offer row) | dormant unless an operator extends an offer; then unrefused | **safe** today | low | goal 3 |
| consent-expiry reminder sweep | `app/_lib/consent-expiry-reminders.ts:18` | via `sendCandidateComm` | dormant (`consent_expires_at` is NULL) | dormant | **safe** | — | goal 3 |
| feedback / interview letters | `app/_lib/interview-letter-delivery.ts:76` | **yes** (passes the whole entry) | refused at `sendCandidateComm` | not refused | **safe** for the agent-fit entry | low | goal 3 |
| candidate status page | `app/_lib/candidate-next-action-server.ts:67` (`nextActionForEntry`) | no | nothing pending (no invite/offer/interview) → null | same | **safe** | — | goal 3 |
| rediscovery | `app/_lib/rediscovery-alert-store.ts:400` | no | unreachable: the pool is built from `profiles`/`analyses`, which agents never write | same | **safe** (by construction) | — | goal 3 |
| retention / erasure sweeps | `app/_lib/db/pipeline.ts:2739`, `:2763` | no | never selected (`consent_expires_at IS NOT NULL` is the predicate) | same | **safe** (and correct — there is no personal data) | — | goal 3 |
| ATS egress | `app/_lib/ats-record.ts:197`; triggers at `screen-wave.ts:631`, `pipeline-entry-action.ts:573`, `offer-finalize.ts:166` | **no** — `AtsCandidateRecord` has **no population field** | no automatic trigger; a hand-reject exports the LLM-authored `spec.name` to the customer's ATS as a candidate `displayName` | `candidate.hired` / `offer.accepted` export it as a hired person | **unclear** | medium | goal 3 |
| offered AI actions on the card | `app/_lib/stage-ai-actions.ts` via `automation-run.ts:369` | no | the drawer offers Screen / Explore alternatives on an agent card; every click 400s | same | **unclear** (dead affordance) | low | goal 1 |

## Tenancy — confirmed clean

- **One entry per workspace.** `createPipelineEntry` mints `m-<wsPrefix><candidateId>-<jobId>` (`app/_lib/db/pipeline.ts:1562`-`1567`): `agent-fit-j1` is `m-agent-fit-j1` in the default team and `m-ws2-agent-fit-j1` in `ws2`. The idempotence read (`findExisting`, `:1570`) and the INSERT (`:1680`) both bind `workspace_id`, so a seeded job with a NULL owner visible to every workspace (`jobVisibleToWorkspace`, `app/_lib/db/jobs.ts:1024`) gets a **separate** entry per team, never a shared one.
- **No write crosses a workspace.** `persistAgentFit` threads one `workspaceId` through `getJob`, `getRoleRubric`, `saveAgentFitSpec` and `createPipelineEntry`. `placeAgentOnBoard` threads it through `stageForRole`, `createPipelineEntry`, `setPipelineEntryStage` and `recordAutomationEvent`. Pinned by `app/_lib/agent-hire/agent-board-entry.test.ts:98` ("a persist in ws-b leaves ws-a's board unchanged") and `app/_lib/db/agents-tenancy.test.ts`.
- One caveat, not a defect: the role-fill close is per team (`closeRoleIfOpen(jobId, workspaceId)`), so finding 1's blast radius is bounded to the team whose agent activated — it does not retire a shared corpus role for everyone.

## `candidateLabel` — the LLM-output trace

`spec.name` comes out of `agentfit_cli` (`transform-run.ts:108`) and out of the
composed App-master spec (`mint.ts:161`). Every place it lands:

1. **Rendered** — the board card and candidate drawer (`listPipelinePage`, `pipeline.ts:817`, which *does* select `population`), the Decisions queue, the screen-wave preview modal (`screen-wave.ts:607` `label`), the Quality rating queue (`hire-rating-queue.ts:95`). React escapes all of it.
2. **Sealed into events** — `recordEvent`'s `candidateLabel` column on every `added` / `moved` / `agent_dispatched` / `agent_activated` / aging-alert row, read back by the activity feed and the decision log.
3. **Mailed** — only through `greetName` / `candidateRecipient` (`comms-dispatch.ts:76`, `:64`). Refused for the agent-fit entry; **reachable for the dispatch card**, where it becomes both the greeting and the outbox `recipient`.
4. **Exported** — `ats-record.ts:197` `candidate.displayName`, shipped to the customer's ATS.
5. **Fed into another prompt** — **no path found.** Both prompt-bearing doors refuse the `agent-` id prefix before the label is read: `resolveCandidatePoolEntry` (`candidate-pool.ts:119`, an explicit guard) and `getProfileRecord` inside `runAutomationTask` (`automation-run.ts:373`). The one residual edge is `rematch`, which copies `entry.candidateLabel` onto a new entry (`automation-run.ts:768`) — unreachable for the same profile reason.

So the label is not a prompt-injection vector today, but that rests entirely on
the `agent-` prefix convention holding. It *is* an un-gated egress on the ATS
wire and in the dispatch card's mail.

## The fixes, ranked

### 1 — the role-fill hook must not count an agent as a hire (high)

**Guard goes in** `runRoleFillHook`, beside the two guards already there
(`isTerminalEntryStatus`, `stageHasRole`), at `app/_lib/stage-hooks-role-fill.ts:88`:
a new `skipped` reason. Prefer **one shared predicate** — the
`recipientRefusal` precedent — in `app/_lib/db/core.ts` beside
`coerceSlatePopulation`, e.g. `isAgentPopulation(entry)`, so the same call
answers findings 1, 2, 3, 7 and 8. Core is already on every one of those graphs.

The deeper half: `listJobPipelineStats` (`pipeline.ts:1149`) is the number the
hook decides on *and* the number the Roles desk shows, and it counts every
terminal-column row with no population filter. Fix it there and both agree —
which is the contract that rollup's own docstring claims.

**Test, red first.** `app/_lib/stage-hooks-role-fill.test.ts` already has the
exact sibling: *"a rejected candidate sitting in the terminal column is not a
hire"* (`:104`). Add *"an agent on the terminal column is not a hire"* — one
`population: 'agent'` entry on a one-seat role, assert `outcome: 'open'`, the
role still open, and zero withdrawals.

**Perf cost: none.** `node scripts/perf/check-budget.mjs --explain 'app/api/agents/report/[token]/route.ts'` → 56 modules / 1158 KB, with `db/core.ts` (205 KB) and `db/pipeline.ts` (201 KB) already the two heaviest on it. `stage-hooks-role-fill.ts` is reached through the boot-registered late binding (`stage-hook-registry.ts`), so it is not on the route's static graph at all, and `population` is already on `PipelineEntry` — no new module, no new edge.

### 2 — `placeAgentOnBoard` must file the card as an agent (high, one line)

`app/_lib/agent-hire/lifecycle.ts:87`: add `population: "agent"` to the
`createPipelineEntry` input, exactly as `persistAgentFit` does. This single line
turns on `recipientRefusal`, `contactVerdict` and every guard added for finding 1
for the dispatch card — it is the cheapest fix with the widest reach, and without
it the guards in 1 and 3 have to be written twice.

**Test.** `app/_lib/agent-hire/lifecycle.test.ts` — assert the created entry's
`population` is `'agent'` on both the `offer` and `hired` moves, and that
`candidateRecipient` on it returns `null`. Red today on both.

**Perf cost: none** — no import changes.

### 3 — the two projections that drop the column (medium)

`listActiveEntriesForAutomation` (`pipeline.ts:2968`) and analytics'
`ROW_COLUMNS` (`analytics.ts:342`) both feed `rowToEntry`/a fold that branches on
population, and neither SELECTs it — so the value silently reads `'human'`. Add
`population` to both column lists. For analytics, the better shape is a SQL
predicate sibling to the existing `notSim()` (`analytics.ts:359`), which is the
precedent for excluding a cohort at the store rather than in the fold.

`rowToEntry`'s own docstring already names this failure mode for `workspace_id`
("omitting it does not fail — it silently reports the DEFAULT team … which is
worse than the missing field, because the value now looks authoritative"). The
same sentence is true of `population` and nothing enforces it.

**Test.** A store-level test asserting that an `population='agent'` row comes
back from `listActiveEntriesForAutomation` with `population === 'agent'` — red
today. Plus one analytics test that an agent on the terminal column does not move
`hired`.

**Perf cost: none** (column lists only).

### 4 — the hire roster and the Quality queue (medium)

`listWorkspaceHires` (`hire-roster.ts:37`): add `population` to the SELECT and a
`population != 'agent'` predicate (or the shared predicate from fix 1). This is
the one whose downstream is a **score calibration curve** — an agent given a 1–5
performance rating contaminates the sample the match score is calibrated against,
which is the indirect route from this entry to a human's ranking.

**Test.** `app/api/pipeline/outcomes/*.test.ts` — an agent on the terminal column
is not in `hires` and not in `unrated`.

**Perf cost: none.**

### 5 — the arrival hooks' refusal reason (low, goal 1)

`stage-hooks.ts:263` and `stage-hooks-homework.ts:162` both collapse
`contactVerdict`'s `agent_population` reason into the `unaddressable` branch,
telling the operator "no deliverable contact address is on file" about an entity
that has no inbox by design, and parking it in the Schedule docket where a human
has to clear it. `ContactRefusalReason` already carries `"agent_population"` as a
distinct member (`comms-contactability.ts:48`) — branch on it and skip without
parking. This is the one finding on the demo path: a `screened` agent card a
recruiter advances leaves a row a person must manually dismiss.

### 6 — the object-literal send path (low)

`candidate-next-action-server.ts:120` builds the `dispatchInterviewInvite`
argument as a literal and omits `population` (and `contact`). The parameter type
at `comms-dispatch.ts:927` is a narrow inline shape that does not declare
`population`, so TypeScript cannot catch it. Widen that parameter to
`CandidateCommTarget` (`comms-dispatch.ts:147`, which does declare it) and pass
the entry — then the compiler enforces it. `dispatchCaseInvite` (`:977`) has the
same narrow shape; its one caller passes the whole entry, so it is latent only.

### 7 — the ATS record has no population field (medium, needs an owner call)

`AtsCandidateRecord` (`ats-record.ts:52`) cannot express "this is an agent", so
any export of either entry lands in the customer's system of record as a person.
Two options, and the choice is the operator's, not mine: add `candidate.population`
to the record and bump `ATS_SCHEMA_VERSION`, or refuse the export outright the way
`AtsRecordRefusedError` already refuses an anonymized entry. I lean to **refuse** —
a schema field a subscriber's connector has never read is a field it will ignore,
and `buildAtsRecord` already has exactly that refusal shape for exactly that
reason. Flagged in `questions`.

## What a Sonnet builder needs for the top group

Fixes **1 + 2 + 3 + 4** are one coherent branch: *"a machine never counts an AI
agent as a hire."* They share one predicate and one test idiom.

1. Add `isAgentPopulation(entry: { population?: string | null }): boolean` to
   `app/_lib/db/core.ts`, beside `coerceSlatePopulation` — pure, no new import,
   already on every consumer's graph. Mirror `recipientRefusal`'s shape: one
   predicate, every caller imports it, nobody re-types the comparison.
2. `app/_lib/agent-hire/lifecycle.ts:87` — add `population: "agent"`.
3. Add `population` to the SELECT in `app/_lib/db/pipeline.ts:2968`,
   `app/api/pipeline/outcomes/hire-roster.ts:41` and `app/_lib/db/analytics.ts:342`.
4. Apply the predicate at `app/_lib/db/pipeline.ts:1149` (`listJobPipelineStats`
   `hired`), `app/_lib/db/analytics.ts:476` and `:524`,
   `app/api/pipeline/outcomes/hire-roster.ts:46`, and as a new `skipped` reason in
   `app/_lib/stage-hooks-role-fill.ts:88`.
5. Red-first tests in `stage-hooks-role-fill.test.ts` (copy the `:104` rejected-
   candidate test), `agent-hire/lifecycle.test.ts`, and the analytics +
   outcomes-route suites.
6. Doc: `docs/features/pipeline/README.md` and the ADR-0012 slate record — the
   population column now gates the hire count, not only the mailbox.
   `scripts/docs/feature-doc-map.json` already couples `app/_lib/db/pipeline*.ts`.
7. Gates: `typecheck`, `lint`, `test:unit`, and `i18n:check` **if** step 5 adds a
   new `skipped` reason that surfaces a localized string — four catalogs in the
   same change.

Perf: every edit is a column list, a predicate call or a pure leaf function. No
new module reaches an `app/api/**/route.ts` graph; `--explain` on the agent report
route shows `db/core.ts` and `db/pipeline.ts` already resident.

## What I could not determine

- **Whether `targetHires` is ever > 1 in practice.** `roleTargetHires` defaults to
  1 (`db/jobs.ts:700`), which is what makes finding 1 fire on a single agent
  activation. With a 3-seat role the agent contributes 1 of 3 and the role stays
  open — so the severity depends on an install's role configuration, which I
  cannot read without opening the operator's DB (forbidden by the brief).
- **Whether finding 1 has ever fired.** Proving it needs `pipeline_events` rows
  (`role_closed` on a job whose terminal column holds an `agent-` candidate id),
  which is a read of `data/kp.sqlite`. Not done.
- **Whether the Personas push can reach `"hired"` without a human.**
  `/api/agents/report/[token]` is token-authenticated and
  `/api/agents/[id]/refresh` is a poll, so both are machine doors; whether the
  *Personas* side requires a human approval before emitting `activated` is
  outside this repo. If it does, finding 1 is human-triggered-but-unattended
  rather than fully autonomous. It does not change the fix.
- **Whether `listJobPipelineStats` omitting a status filter is a separate defect.**
  It counts every terminal-column row regardless of `status`, so a `rejected` row
  parked there counts as a hire — the exact case
  `stage-hooks-role-fill.test.ts:104` proves the *hook* handles (via
  `isTerminalEntryStatus` on the arriving entry) but which the *rollup* does not.
  Adjacent, not agent-specific, and I did not chase it.
- **The right answer for the ATS wire** (fix 7) — schema field vs refusal is a
  product call about a published contract.

## Gates

| gate | result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint` | pass (0 errors, 49 pre-existing warnings) |
| `npm run test:unit -- 'app/_lib/auth/**/*.test.ts' 'app/api/**/*.test.ts'` | pass — 2114/2114 |
| `npm run test:unit -- 'app/_lib/agent-hire/**/*.test.ts' 'app/_lib/stage-hooks-role-fill.test.ts' 'app/_lib/comms-recipient.test.ts'` | pass — 48/48 (read-only, run to confirm the actors behave as traced) |
| `npm run docs:check` | pass |
