# Architecture review — 2026-10-07

The first architecture review of kp. It answers one question: **which few structural
problems will cost the most later, and which of them are worth competing with product
work now?** It reads code and changes none.

- **Head.** `20162c419` (local `main` when the review started). Every `file:line` below
  is at that head. Line numbers will drift; the claims they back should not.
- **Scope.** The six inputs of the `codebase-architecture-review` charter, plus one
  problem found on the way (#3). `scripts/kpi/` was left out on purpose: another change
  is fixing the reasons meter there. Where the meter matters, this review names the seam
  it reads (`app/_lib/reasons-coverage.ts`), not the script.
- **Constraints.** ADRs 0001–0017 were read first and treated as settled. No finding
  below reverses one. One (#4) meets an ADR's own "what would change our mind" test and
  says so. Two (#3, #6) find that an accepted ADR describes behaviour the code does not
  have yet.
- **Method.** Read the ADRs, then the code each input names. The counts in #5 and #6
  came from a full sweep of the tree. The totals (1,654 / 573 / 27 test files; 30
  spawned modules), the codegen export list, the cast, and every divergence and drift
  cited below were then re-checked by hand at the head above. The 13 / 5 / 4 / 5 split
  of the 27 files in #5 and the "about four" pydantic-ready seams in #6 are the sweep's
  classification.

## The goals, in the charter's order

1. **Council.** Every feature passes the LLM council.
2. **End to end.** One role runs end to end without a human step. ADR 0011 and
   `role-run-metrics.ts` call this "goal 1".
3. **Need to role.** Hire-from-need composes a role.
4. **Reasons.** Every automated step is explainable to the candidate. ADR 0017 calls
   this "key goal 4".

## Ranking, by cost of waiting

| # | Finding | Input | Verdict | Cost of waiting | Size |
| --- | --- | --- | --- | --- | --- |
| 1 | A machine verdict is kept in the mutable gate slot | (1) | **compete now** | The matching council's must-address stays open. Every Match add made meanwhile becomes a legacy row whose reasons are lost at its first transition. | ~14 files, one branch |
| 2 | "Hired" is counted from the stage alone, in five different ways | (4) | **compete now** (small) | The role-fill hook can close a role and withdraw its candidates on a count that includes a rejected person. | ~6 files, one branch |
| 3 | The role-run gate commit changes nothing and seals nothing | (6) | later: before any door | The end-to-end goal is read off a run that no recruiter can start. ADR 0011 claims behaviour that is not there. | 4–6 files and a route, two branches |
| 4 | Seal and write on two connections | (2) | later: with the first atomic seal | Low today (one writer process). It grows with every commit that spans stores. | 3 stores and 3 tests, one branch |
| 5 | Tests run code against hand-written copies of production tables | (5) | **compete now** for the ratchet only; conversions later | This pattern is why the reasons meter crashed on every real install. It also makes #4 dearer. | 1 new test now, 13 files later |
| 6 | 28 of the 30 Python→TS seams are mirrored by hand | (3) | later; the Match seam rides #1 | Four seams have already drifted, and each new CLI adds one. | Per seam: a design change, not a sweep |

## 1. A machine verdict is kept in the mutable gate slot

**Problem.** A Match add stores the matcher's verdict as prose, written in the
recruiter's locale, in `pipeline_entries.approval_detail`. Five other payload shapes
share that column and most transitions clear it, so the stored verdict is neither a
snapshot nor a record.

**Evidence.**

- *The client composes prose.* `matchReasons` builds a sentence in the reader's locale
  from the result's fit tier, its best and worst score dimension and a few skill names
  (`app/features/insights/matrix/focus/matchReasons.ts:42-91`, called at
  `useMatchResultsPipeline.ts:49`). The add sends the sentence, the matched skills and
  the missing skills (`useMatchResultsPipeline.ts:73-75`). The `unproven` skills are
  computed (`matchReasons.ts:23`, `:45`) and dropped. No locale and no scorer version
  travel with it.
- *The server stores the prose as the record.* The route stores
  `{summary, strengths, redFlags}` (`app/api/pipeline/route.ts:128-136`), and the insert
  writes it (`app/_lib/db/pipeline.ts:1700`).
- *The slot is shared.* `approval_detail` is one of six payload shapes keyed by
  `approval_kind`. The others are the calendar slot string (`"Tue 14:00"`,
  `pipeline.ts:3447`, `pipeline-entry-action.ts:502`, `stage-hooks.ts:286`, `:361`), the
  screening recommendation (`automation-run.ts:633`, `devcase-run.ts:1214`), the
  rejection review (`automation-pass.ts:517`), the scorecard
  (`automation-run.ts:686`, `interview-scorecard-commit.ts:61`, `:174`,
  `app/api/interview-prep/scorecard/route.ts:215`) and the offer draft
  (`automation-run.ts:690`). That is 13 `setApproval` call sites outside the store.
- *Most transitions clear it.* Reinstate (`pipeline.ts:1425`), any `setApproval`
  (`:3118`), a confirmed schedule (`:3431`, `:3437`), a screening accept (`:3447`), an
  accept (`:3455`, `:3462`), a board drag (`:3553`) and a rematch (`:3635`) all clear or
  overwrite it. A reject nulls `approval_kind` and leaves the detail (`:3409`), so after
  a reject the prose stays in the column with nothing saying what it is.
- *The add's own event cannot hold it.* The `added` event stores the code
  `reason:addedToPipeline` (`pipeline.ts:1724-1733`). `pipeline_events` has only a
  `detail TEXT` column (`app/_lib/db/core.ts:617-637`), which `pipeline.ts:3161-3166`
  states outright. A re-add onto an existing row writes no `added` event
  (`pipeline.ts:1588-1667`).
- *The meter reads the live row.* `matchFiledRanking` parses `approvalDetail.summary`
  (`reasons-coverage.ts:73-82`) and counts a cleared slot as a miss (`:123-127`). The
  rejection arm beside it does what this one should: it resolves a sealed code through
  the shared resolver (`:153-163`).
- *The pattern is general.* The commit door has to copy the AI verdict out of the slot
  before its own write clears it (`pipeline-entry-action.ts:566-568`, `aiVerdict` at
  `:98`). No other clearing path does. The machine's recommendation code survives only
  as a pipeline event detail (`automation-run.ts:634`, `:687`); its reasons do not.

**The three homes.**

| | (a) A dedicated record at insert (column or table) | (b) The `added` pipeline event | (c) The sealed decision chain |
| --- | --- | --- | --- |
| Immutable | Only by convention plus a source guard. `approval_detail` shows how a convention on this row ends. | No write-once rule; erasure rewrites event rows. | Yes, by construction: hash-chained, and `verifyDecisionChain` detects an edit (`decision-record-store.ts:468`). |
| Codes plus params | Any shape. | No: `detail TEXT` only. It needs a payload column on a table every activity surface reads. | Yes: `reasonCode` plus `inputs` is already the house shape (`SealedReason`, `decision-attribution.ts:477-493`). |
| Rendered in the reader's locale | Needs a new resolver. | Needs a new resolver and another prefix protocol, like `approval:` (`pipeline.ts:3161-3167`). | `waveReasonText` already resolves a sealed code in the reader's language (`decision-attribution.ts:522-534`). |
| Reaches the candidate | No. | No. | Yes. `/status/[token]` shows sealed kinds from an allowlist, with a fact extractor per kind (`status-decisions.ts:89-104`, `:251-255`), and `factsCoverage()` counts them. |
| Same transaction as the insert | Yes. | Yes. | Not today: the chain has its own connection (`decision-record-store.ts:234-270`). See #4. |
| Re-add of an existing entry | Needs a fill-only rule. | Writes no event. | Sealed per add, keyed by entry id. |
| Precedent | None. | None. | `group_eval_lead` already seals a ranking verdict (`group-eval-run.ts:852`). |

**Recommendation: (c), the sealed chain.** It is the only home that is already
immutable, already stores codes plus params, already renders in the reader's language
and already reaches the candidate. One write therefore meets both standards the craft
member cited (capture the machine verdict before a human overwrites it; structured facts
plus a locale-invariant audit string) and serves the reasons goal.

- **The client sends facts, not a sentence.** The facts are `fitTier`, the best and worst
  dimension as `{labelCode, percent}`, the matched, unproven and missing skill names
  (bounded), `matchScore` and the scorer version. `matchReasons` splits into
  `matchReasonFacts(m)` and a pure renderer over the facts. The Match screen keeps using
  the renderer.
- **The route validates, then seals before it inserts.** It checks the facts against
  closed vocabularies (fit tiers, dimension label codes) and length bounds. Then it seals
  one record seal-first, as ADR 0017 does:
  - kind: a new one, for example `match_verdict`;
  - actor: the recruiter who filed (`humanActor()`);
  - `policyVersion`: the scorer version;
  - `candidateRef`: the entry id;
  - `reasonCode`: for example `match_fit`;
  - `inputs`: the facts;
  - `rationale`: a byte-stable code string, not prose.

  Pass the workspace explicitly: before the insert, the store resolves an unknown entry
  to the default workspace (`decision-record-store.ts:319-325`).
- **Stop writing `approval_detail` for a Match add.** The Decisions cohort, which parses
  that column today (`DecisionsAnalysisParts.tsx:168-185`), reads the sealed facts
  through `listDecisionRecordsForRefs` (`decision-record-store.ts:431`) and renders them
  with the same renderer, in the reader's locale.
- **Trust.** The facts come from the browser, as `match_score` already does
  (`useMatchResultsPipeline.ts:65`). The record therefore attests "what the recruiter was
  shown when they filed", not "what the server computed". The actor field has to say so
  (the recruiter, not `auto:match`). Recomputing the verdict on the server would cost a
  Python spawn per add. That is not recommended now.

**Files a rework touches:**

- `matchReasons.ts` and `useMatchResultsPipeline.ts`;
- `app/api/pipeline/route.ts`;
- `app/_lib/db/pipeline.ts`, where the `approvalDetail` input loses its Match use
  (comment at `:1491-1495`);
- `decision-attribution.ts`, for a resolver over the `match.reasons.*` keys the client
  already uses;
- `status-decisions.ts`, if the owner makes the kind visible to candidates (see the
  questions at the end);
- `reasons-coverage.ts` and `DecisionsAnalysisParts.tsx`;
- `messages/{en,cs,de,fr}.json`;
- `pipeline/jobfit/codegen.py` and `matchTypes.ts`, so the label codes the record stores
  are generated rather than typed by hand (#6);
- the route and store tests, and the matching feature doc.

The meter script in `scripts/kpi/` is a consumer and changes with it.

**How the meter reads it.** A Match-filed entry has `source_channel = 'match'`
(`route.ts:156-157`, `:198`). For each one, the meter looks up the sealed match record by
`candidate_ref`. It resolves that record's code and params through the same resolver the
product surfaces use. That is rule 1 of `reasons-coverage.ts:16-21` ("it resolves, it
does not pattern-match"), and it is how the rejection arm already works. Concretely,
`matchFiledRanking` takes the sealed record, or null, instead of the raw column.

**Legacy Match adds: no backfill.** The facts cannot be recovered from the prose,
because the sentence is localized and the fit tier and dimensions are inside it.
Re-running the match today would seal a different verdict from the one the recruiter
saw, stamped with today's date, as if it were evidence. Instead, the meter reports
Match-filed entries that have no sealed record as their own bucket:

- "legacy prose snapshot" while the column still holds the prose;
- "legacy, snapshot cleared before the record existed" once it has been cleared.

The bucket can only shrink, and the meter states its size rather than folding it into
the headline figure.

**Cost of waiting.**

- *Council.* The must-address on candidate-job-matching stays open until this lands.
- *Reasons.* Every Match add made in the meantime is a legacy row, and its reasons are
  gone at its first transition. The cost grows with every add.

**Size.** About 14 files, one branch. If #4 lands first, the seal and the insert share one
IMMEDIATE transaction. If it does not, seal-first with ADR 0017's residue is acceptable:
an insert that fails after the seal leaves a record of a verdict that was shown but never
filed.

**Verdict: compete now.**

**ADR check.** This extends ADR 0017's seal-first rule to a ranking verdict and uses the
chain the way ADR 0011 §5 (row P5) and ADR 0017 describe it. It reverses nothing.

### Where `app/_lib/db/pipeline.ts` belongs: under (1)

The file has 3,642 lines, 69 exported functions and about 117 non-test importers. Its
size is not what costs. What costs is that nearly every transition in it has to handle
the gate slot: there are 27 references to `approval_detail` / `approvalDetail`. Moving
machine verdicts out of the slot (#1) takes that reason away. Splitting the file by size
would not.

The one split that was tried shows the risk:

- `app/_lib/db/pipeline-events.ts` declares eleven exports, and `pipeline.ts` still
  declares all eleven itself.
- Only one of them is imported from the split file (`stage-hooks.ts:49`).
- Its copy of `PIPELINE_REASON_CODES` has drifted to 7 codes; the one in `pipeline.ts`
  has 9 (`pipeline-events.ts:197-213` against `pipeline.ts:565-586`).

Deleting that file and re-pointing the one import is a cleanup for #1's branch.

It does not belong under (2), because the connection problem lives in the stores, not in
this file.

## 2. "Hired" is counted from the stage alone

**Problem.** `listJobPipelineStats` counts every row on a terminal stage as a hire,
whatever its status. The role-fill hook then closes the role and withdraws every
in-flight candidate on that count.

**Evidence.**

- *The count ignores status.* `listJobPipelineStats` groups by stage with no status filter
  (`pipeline.ts:1128-1135`) and counts `hired` from the stage role alone (`:1149`).
- *A rejected person can stand on the terminal column.* The commit door refuses only an
  accept on a closed entry (`pipeline-entry-action.ts:562-563`), and the reject write has
  no stage guard (`pipeline.ts:3409`). ADR 0013 §2 records this door ("a reject on a hired
  row, which has no stage guard"), and ADR 0015 lists this count among its known open
  edges.
- *The hook acts on the count.* The role-fill hook reads it
  (`stage-hooks-role-fill.ts:107`), compares it with the target (`:112`), closes the role
  (`:115`) and withdraws the rest as `role_closed` (`:123`). With a target of 2, one real
  hire plus one person rejected on the Hired column closes the role. The charter's list of
  consumers left this one out, and it is the one that affects people.
- *The code disagrees with itself about what a hire is.* There are five predicates:

  | Predicate | Where | Agents | Status |
  | --- | --- | --- | --- |
  | `listJobPipelineStats` | `pipeline.ts:1149` | excluded | ignored |
  | Jobs-browse join behind the `filled` status | `jobs.ts:607-610`, `:685-687` | **counted** | ignored |
  | Analytics `byJob` | `analytics.ts:476` (agents dropped by the row query at `:359-368`) | excluded | ignored |
  | Cohort fold | `analytics-cohort.ts:111-115` | excluded upstream | ignored |
  | Hire roster | `app/api/pipeline/outcomes/hire-roster.ts:41` | excluded | **filtered** |

  Only the roster agrees with the hook's own first check: "A rejected / declined /
  withdrawn candidate is not a hire, whatever column the row happens to sit on"
  (`stage-hooks-role-fill.ts:87-89`).
- *No test covers the status case* (`pipeline-job-stats.test.ts:32`, `:49`, `:57`, `:68`).

**Answer to the question: a defect, not intent.** The docstring's contract is parity with
analytics (`pipeline.ts:1121-1123`), and both are wrong in the same way. Counting everyone
in `total` and `reachedInterview` is intended (ADR 0015 Consequences) and stays.

**Cost of waiting.**

- *End to end.* An automated step closes a role and ends candidacies, with no human
  involved, on a false count.
- *Reasons.* The withdrawn candidates' "why" is a role that was not actually filled.
- *Display.* The display consumers over-report: `app/api/jds/route.ts:50` and the palette
  preview (`resolve-entities.ts:93`, `resolve-hiring.ts:21`,
  `resolve-insights-settings.ts:33`).

The trigger is rare, the result affects people, and the fix is cheap.

**Shape.** Add one predicate pair in `core.ts`, beside `isAgentPopulation` /
`notAgentSql` (ADR 0015 §1 is the precedent): `isHireRow(entry, axis)` and a SQL twin.
A row is a hire when it is on a terminal-role stage, its status is not terminal and it is
not an agent. All five sites call the pair. Add one test row per exclusion at each site.
Whether a reject on the terminal column should be refused at the door is a separate
product question; the count must be right either way.

**Size.** About 6 files (`core.ts`, `pipeline.ts`, `jobs.ts`, `analytics.ts`,
`analytics-cohort.ts`, `hire-roster.ts`) plus tests. One branch, about a day.

**Verdict: compete now** (small).

## 3. The role-run gate commit changes nothing and seals nothing

**Problem.** The role-run ledger (ADR 0011) has no route. Its gate commit does not change
the board, mint an invite or offer, or seal a decision. The ADR, the feature doc and the
code comments all say it does.

**Evidence.**

- *No door.* Nothing under `app/api/` imports `role-run-engine.ts` or `db/role-runs.ts`.
  The only callers outside tests are the engine's own modules and the KPI demo that
  ADR 0011's amendments name.
- *The commit does nothing outside the ledger.* `commitRoleRunStageGate`
  (`role-run-engine.ts:464-520`) verifies and spends the token (`:481`) and appends an
  artifact (`:501`). It calls no board door, no `createScheduleInvite`, no `createOffer`
  and no seal.
- *The approver is named nowhere.* The commit records the approver as a hash (`:514`).
  The comment beside it says "the sealed decision record (sealDecisionRecord) is where the
  attributable identity lives" (`:512-513`), but no such record is written. A role-run
  gate approval therefore names its approver nowhere.
- *The claims.* `role-run-stages.ts:75`, `:78` ("the gate commit mints the token", "the
  gate commit calls createOffer"); `role-run-engine.ts:213`, `:257`;
  `docs/features/hiring-pipeline/role-run-ledger.md:99-102`, `:116-117`; ADR 0011 §5 row
  P5 (`:146`) and its Consequences (`:192-194`).
- *A second screening policy.* The screen stage uses a fixed `SCREEN_ADVANCE_FLOOR = 60`
  (`role-run-engine.ts:156`, used at `:162-191`). The workspace's own floor, which
  screen-wave and the automation pass apply, sits beside it. The default runners are
  documented as a keyless floor that real engines are later attached to, stage by stage
  (`role-run-engine.ts:70-79`).

**Cost of waiting.**

- *End to end.* The goal is read off a run that no recruiter can start and whose
  decisions no candidate feels. Board work does not move the reading, and runner work
  does not reach a candidate.
- *Reasons.* Gate approvals have no sealed record.

The cost is in steering, not in harm: no real person is affected while there is no door.
It grows with every stage runner attached to the ledger rather than to the board's doors.

**Shape.** Decide before the first door that the gate commit calls the board's existing
doors and is not a second effect path:

| Gate | Board door it calls |
| --- | --- |
| Rejection | `runPipelineEntryAction`'s seal-first reject, or screen-wave's commit, per entry |
| Invite | `createScheduleInvite` |
| Offer | The extend path: `extendDraftedOffer` / `getOrCreateOpenOffer` |

Each commit also seals one record naming the approver. Such a commit spans the token
spend, the artifact, the seal and a store write, across three or four connections. That
is the trigger for #4.

**Size.** `role-run-engine.ts`, `role-run-gates.ts`, a route under `app/api/roles/`,
tests and an amendment to ADR 0011. Two branches: first the seal and the doors, then the
route.

**Verdict: later, before any production door to `commitRoleRunStageGate`.** The false
claims should be corrected now. That means an ADR amendment and a feature-doc edit, both
outside this review's paths (see the questions at the end).

**ADR check.** This enacts ADR 0011 §5 and its Consequences. It reverses nothing.

## 4. Seal and write on two connections

**Problem.** The decision chain opens its own database connection, so a seal cannot join
the transaction of the write it records. Calling it inside one does worse than lose
atomicity: the seal fails.

**Evidence.**

- *Many connections, one file.* 27 modules besides `core.ts` open their own connection to
  the same file through `openStore()` (`app/_lib/db-path.ts:143-163`). Among them are
  `decision-record-store.ts` (`:234-270`), `offers-store.ts` and `schedule-store.ts`.
  The decision store gives its reason as "so it never touches the fork-active db.ts"
  (`decision-record-store.ts:10-13`). That is about merge conflicts during a past fork,
  not about anything at runtime.
- *Why a seal inside a transaction fails.* Inside one of `pipeline.ts`'s `.immediate()`
  transactions, the main connection holds the write lock. A seal on the decision
  connection needs that lock for its INSERT, and it can never get it: its own caller
  holds it, and the process is single-threaded, so nothing can release it in the
  meantime. The seal ends in `SQLITE_BUSY`. The `busy_timeout = 5000` set on every
  connection (`db-path.ts:160`) cannot help; at most it delays the failure. That is why
  ADR 0017 could only seal first and then write.
- *How the 18 seal call sites behave.* Two seal first and refuse on failure
  (`screen-wave.ts:535`, `pipeline-entry-action.ts:577`). The other 16 are best-effort,
  after their write:
  - the four that ADR 0017 names: offer terms (`pipeline-entry-action.ts:308`, after the
    mint at `:286`), the human-round handoff (`:521`), reinstate
    (`app/api/pipeline/[id]/route.ts:162`, after `:153`) and the wave reversal
    (`app/api/pipeline/command/reverse.ts:151`, after `:142`);
  - `automation-run.ts:662`;
  - five schedule seals (`app/api/schedule/route.ts:281`, `:315`, `:336`, `:440`, `:460`);
  - `interview-scorecard-commit.ts:135` and
    `app/api/interview-prep/scorecard/route.ts:181`;
  - `group-eval-run.ts:852`, `:877`;
  - `app/api/analytics/calibration/apply-threshold/route.ts:134`;
  - the holdout seal (`screen-wave.ts:379`).
- *Fallbacks for a state production never has.* The store carries fallbacks for
  "pipeline_entries absent on this connection" (`decision-record-store.ts:319-325`,
  `:660-666`). In production it is the same file. Only the hand-written test schemas of
  #5 create that state.

**Cost today: little.** ADR 0017's residue needs a second process to write the row
between two synchronous statements. A self-hosted install runs one Node process and one
replica (ADR 0002), and the Python children spawned per request do not write
`pipeline_entries`: `companion_brain.py` opens SQLite only for its own index, and the two
other Python modules that open it are seed scripts. A best-effort seal fails only when
the HMAC key is missing or a lock times out, which is rare.

**When it starts to cost.** At the first commit that must be atomic across stores: #1, if
its seal is to share the insert's transaction, and #3's gate commit (token, artifact,
seal, and an invite or offer).

**Recommended shape.** Not a transaction manager across stores. Give the main connection
to the stores that take part in a commit affecting a person: `decision-record-store`
first, then `offers-store` and `schedule-store`.

- Their `db()` returns `ensureDb()` and runs its DDL on it once.
- better-sqlite3 nests a transaction opened inside another on the same handle as a
  savepoint, so `ensureDb().transaction(() => { seal(); write(); }).immediate()` is the
  whole primitive.
- Each call site then chooses. Adverse commits, and commits that affect a person, seal
  inside the transaction and refuse together. Administrative records stay outside, and
  best-effort.
- The other ~24 stores stay as they are.

**Size.** The 3 store files; the 3 tests that stub `pipeline_entries` into the shared test
database (#5); and removing the two fallbacks. One branch.

**Verdict: later, with the first caller that needs an atomic seal (#1 or #3).**

**ADR check.** This meets the first item of ADR 0017's "what would change our mind" ("the
seal and the write sharing one connection"), so ADR 0017 would be amended to retire its
residue. It is consistent with ADR 0002: IMMEDIATE transactions on a synchronous driver.

## 5. Tests run code against hand-written copies of production tables

**Problem.** Some tests create a production table by hand and run real code against it,
so a test can pass on a schema that production does not have.

**Counts.** Over the 1,654 `*.test.ts` files under `app/`, `packages/`, `edge/` and
`i18n/`:

- **573** import `app/_lib/testing/unit-db.ts`. It points `KP_DB_PATH` at a throwaway file,
  so the real schema code builds every table (`unit-db.ts:119-128`).
- **14** set their own temporary `KP_DB_PATH` and then load the real `core.ts` or stores.
- **27** contain `CREATE TABLE`:

  | Files | What they do |
  | --- | --- |
  | 13 | Run code against a hand-written copy of a production table |
  | 5 | Plant an old shape on purpose so the real migration upgrades it. That is what a migration test is for, and they are fine. |
  | 4 | Create tables that exist only in the test |
  | 5 | Only mention it in a comment or a regex |

**Divergences already present among the 13.**

- `app/_lib/decision-record-store.test.ts:48`,
  `app/_lib/decision-record-store-batch.test.ts:22` and
  `app/api/status/status-decisions.test.ts:50` create `pipeline_entries(id, workspace_id)`,
  two of its 41 columns, in the shared unit-db file. A later `ensureDb()` in the same
  process would skip the real CREATE (`core.ts:576`) and then fail to create the `job_id`
  index (`core.ts:614`).
- `app/_lib/offers-store.test.ts:56-59` leaves out `candidate_label NOT NULL` and inserts
  rows that production would refuse.
- `app/_lib/db/rollback-drill.test.ts:279` and `:282` (`pipeline_entries`,
  `pipeline_events`) lack columns that `core.ts` declares only in its original CREATE and
  never adds in a migration (`candidate_id`, `archetype`, `approval_detail` among them), so
  the current migration code would not bring a database of that shape up to date. The
  comment at `:368` still calls it "precisely the shape core-migrations.test.ts proves the
  current code carries forward". The same file's `jobs` copy (`:452`) has a `city` column
  that production does not have.
- `llm-secret.test.ts:123` creates `provider_keys` with no NOT NULL and no primary key, and
  inserts a NULL ciphertext (`:129`), a state production cannot hold, to test that a NULL
  is skipped.

**No gate covers this.**

- `db-test-isolation-guard.test.ts` checks only the database path.
- `store-migrations-guard.test.ts` scans only non-test files.
- The constitution check's CREATE TABLE rule skips test files
  (`scripts/review/constitution-check.mjs:450-456`), and its own fixture pins that ("a
  temp table in a test does not fire", `scripts/review/__tests__/constitution-check.test.mjs:388`).

The only defence is a comment ("never an inline CREATE TABLE copy",
`thread-autonomy.test.ts:2`).

**Cost of waiting.**

- *Council and Reasons.* By the charter's account, the reasons meter shipped green and
  crashed on every real install for exactly this reason (`scripts/kpi/` was not reviewed
  here).
- *#4 gets dearer.* The three decision-store tests must be rewritten before that store can
  share the main connection.

**Shape.**

- *Now: one ratchet test,* in the spirit of ADR 0007. It collects production table names
  from the CREATE TABLE statements in non-test files and fails when a test file that is
  not on an allowlist creates one. The allowlist starts as today's 13 copies plus the 5
  migration fixtures, each with its reason, and may only shrink.
- *Later: convert the 13 to unit-db.* Most need no hand-written table at all. Start with
  the three decision-store tests, as part of #4.

**Size.** One test file now; 13 conversions later.

**Verdict: compete now for the ratchet; later for the conversions.**

## 6. 28 of the 30 Python→TS seams are mirrored by hand

**Problem.** ADR 0003 says "Schemas are generated, not hand-mirrored", but codegen exports
seven models, and 28 of the 30 Python modules the app spawns reach TypeScript through a
cast.

**Evidence.**

- *What codegen exports.* `AnalysisResult`, `RoleSpec`, `RoleBrief`, `RubricAxis` and
  the three App-master models (`pipeline/jobfit/codegen.py:156-166`). The matching models
  are not among them (`MatchResult` at `matching.py:288`, `MatchResponse` at `:355`).
- *How the 30 spawned modules are parsed.*

  | Modules | How the result is checked |
  | --- | --- |
  | 1 (`cli`, the analysis) | The generated schema (`analyze-run.ts:419`) |
  | 1 (`repo_scan_cli`) | Late, when the row is read back (`db/intakes.ts:156`) |
  | 28 | None: they go through `parsePythonJson<T>`, whose last line is `return parsed as T` (`python-runner.ts:665`), into a hand-written type or coercer |

  Examples of the 28: match (`matchTypes.ts:52-175`, cast at `useMatchTabRun.ts:159`),
  profile (`profileTypes.ts:70`), jobs (`JobRecord`, `core.ts:3152`), winnability
  (`app/features/library/jobs/coach/winnabilityTypes.ts`), the ten devcase calls through
  `runDevcaseCli<T>` (`devcase-run.ts:37`, returning at `:51`), and intake, which
  casts `as RoleBrief` (`intake-run.ts:144`) although `roleBriefSchema` exists.
- *Four seams have already drifted.*
  - The TS `MatchResult` has no `targetAlignment` (`matching.py:333`), and `MatchResponse`
    has no `blocked` (`:361`).
  - The profile payload lacks `archetypeConfidence`, `archetypeReasons`, `potentialScore`
    and `completeness` (`profile.py:101-102`, `:122-124`).
  - `JobRecord` lacks `salaryCurrency` and `salaryPeriod` (`jobs.py:153-154`).
  - The winnability salary type lacks `jobCurrency` and `marketCurrency`
    (`winnability.py:199-200`).

**Sweep or design change? A design change.**

- *About four seams can be closed by listing an existing Pydantic model and swapping the
  cast for a `safeParse`:* `MatchResult`/`MatchResponse`, `Job`, `CandidateProfileV2`, and
  intake (by calling `roleBriefSchema` at `intake-run.ts:144`). Even those first need their
  `str` fields tightened to `Literal` and their drift reconciled.
- *The other ~24 print plain dicts* and need models written first.
- *codegen has limits a sweep would hit.* It has no support for discriminated unions
  (`oneOf` becomes `z.unknown()`) or recursion, and tuples become string arrays
  (`codegen.py:80-118`).

**Cost of waiting.**

- *Council.* The craft lens raises this pattern on every feature it reviews, and each fix
  is local.
- *Reasons.* The Match label codes that #1 would seal are typed by hand today.

The cost per day is low. It grows by one seam with each new CLI.

**Shape.** Close a seam when a feature touches it, starting with Match inside #1. Do not
sweep. When the first seam is converted, add a ratchet on the number of
`parsePythonJson<` call sites without a schema (ADR 0007), so the number can only go down.

**Verdict: later; the Match seam rides #1.**

**ADR check.** This enforces ADR 0003; it does not reverse it. Today the ADR's "Schemas are
generated" bullet holds for one seam in thirty.

## Not worth it

These were weighed and should not be raised again unless the stated condition changes.

- **Splitting `pipeline.ts` by size.** The coupling that costs is the gate slot (#1), not
  the line count, and the one split tried left a stale twin that drifted. Reopen if a
  change cannot be reviewed for the size alone.
- **A unit of work or transaction manager over all 27 isolated connections.** Only three
  stores take part in a commit that affects a person (#4). Reopen if a fourth does.
- **Backfilling legacy Match snapshots into the chain.** It would seal a reconstruction as
  evidence (#1).
- **Home (b): a structured payload column on `pipeline_events`.** It is a schema change to
  the table every activity surface reads, it cannot be written on a re-add, and it does
  not reach the candidate.
- **A server-side recompute of the Match verdict at add time.** It costs a Python spawn per
  add and seals a verdict the recruiter did not see. Reopen if match runs are ever
  persisted.
- **A codegen sweep over all 28 seams.** About 24 of them need models first (#6).
- **Converting the 5 migration fixtures that plant an old shape.** Planting the old shape
  is the point of those tests (#5).
- **Filtering `total` and `reachedInterview` by status.** ADR 0015 intends them to count
  everyone on the board.
- **Turning the Python pipeline into a service so the two sides can share types.** ADR 0003
  stands. The seam problem is codegen coverage, not process shape.
- **Moving the other ~24 isolated stores onto the main connection.** Nothing commits
  across them.

## Questions this review cannot answer

- **May a candidate see the Match verdict?** Should the new sealed kind join
  `CANDIDATE_VISIBLE_DECISION_KINDS` and `AI_VERDICT_DECISION_KINDS`
  (`status-decisions.ts:89-104`, `:261-267`)? A ranking against a role the candidate may
  never have applied for is a different disclosure from a rejection. This is an owner
  call; #1 works either way.
- **Who corrects the claims in #3?** ADR 0011 (row P5 and its Consequences), the
  role-run-ledger feature doc and the code comments cited in #3 describe a gate commit that
  seals and mints. Those edits are outside this review's paths.
- **Should a reject on a terminal-column entry be refused at the door, or stay possible
  and simply stop counting as a hire?** #2 fixes the count either way.
