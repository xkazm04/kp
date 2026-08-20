# Analytics

Hiring measurement for the workspace: funnel health, forward projection, channel and
compute economics, and the auditable record of what the automation decided.

Everything here is computed from SQLite by deterministic TypeScript. **No LLM key is
involved anywhere in this tab** — a keyless deployment gets the identical surface,
calibration and audit trail included. The one env var that changes anything is
`KP_DECISION_HMAC_KEY`, and it changes what the chain may *claim*, not what renders.

## Entry points

| Surface | Component |
| --- | --- |
| `/?tab=analytics` | `app/features/insights/analytics/AnalyticsTab.tsx` — the only door, loaded by `app/features/shell/tabChunks.ts` |
| `?sec=performance\|economics\|quality` | `sections/AnalyticsSectionNav.tsx` |
| `?win=30\|90` (absent = all time) | `AnalyticsHeader.tsx` |

Not on `app/_lib/auth/public-routes.ts`, so a session is required;
`/api/decisions/records` and `/api/analytics/calibration/apply-threshold` re-verify with
`requireOperator()` on top.

## Three sections, not one scroll

| Section (`?sec=`) | Question | Holds |
| --- | --- | --- |
| `performance` (default) | How is hiring going? | funnel band, stage dwell, forecast, momentum, by-role, archetype, company benchmark |
| `economics` | What does it cost, what earns it back? | the comparison board, automation ROI, compute cost |
| `quality` | Can I trust the scoring, and prove what we decided? | trust verdict, calibration, sealed records, decision log |

- The section vocabulary is one literal array with a derived union and a runtime guard
  (`sections/analyticsSections.ts`) — the `app/features/shell/tabs.ts` shape — so an unknown
  `?sec=` resolves to the default instead of rendering nothing
  (`sections/analyticsSections.test.ts`, `e2e/analytics-sections.spec.ts`).
- `?sec=` is an **inbox, not state**: the active section lives in React state, the param is
  read once on arrival then cleared (`app/features/shell/nav/useUrlInboxState.ts`). A shared
  link still lands; clicking between sections writes nothing to the URL. `?win=` stays a real
  URL param — a view preference that survives a round-trip to the board, and it changes the
  fetch.
- **"Copy link to this view" mints what the address bar cannot.** Because the inbox clears
  itself, the URL after arriving on `/?tab=analytics&sec=quality` reads `/`, so the header
  carries an explicit affordance beside the metric-pack download instead of mirroring state back
  into the URL. `analyticsViewUrl({ origin, section, days })` (`analyticsViewLink.ts` — pure,
  with `origin` passed in so it stays SSR-safe) composes
  `<origin>/?tab=analytics&sec=<id>&win=<30|90>` against an **empty** query string (the
  `usePipelineSavedViews.copyViewLink` idiom), so a shared link carries the view and never the
  sender's board filter or candidate selection; `win` is omitted all-time, because absence *is*
  all time. `AnalyticsCopyViewLink.tsx` renders it as a real `<button>` and **tells the truth
  about the clipboard**: `copyText` reports whether the write landed, so a blocked clipboard
  (insecure origin, denied permission) falls back to the URL in a selectable read-only field
  instead of printing "Link copied", and the confirmation also goes to an `aria-live` status
  region because the button's `title` can win the accessible-name computation. `AnalyticsHeader`
  renders the control **only when it knows the section** — minting a link to the default section
  would hand the reader a URL that lands somewhere else. `analyticsViewLink.test.ts` (5 checks)
  feeds the minted URL back through the REAL readers (`resolveTabParam`,
  `resolveAnalyticsSection`, and AnalyticsTab's own `?win=` parse), so a rename on either side
  breaks the test rather than a colleague's link. **The inbox is deliberately untouched**: it
  adopts an incoming value and then clears the param, which is what stops a deep link bouncing
  back to Overview one render after it lands — so the URL is not a view record, and the reading
  half already worked. Only the minting half was missing.
- **Each section is its own `next/dynamic` chunk**, with per-panel chunks inside
  (`sections/sectionChunks.tsx`): a reader in Economics never downloads the reliability
  diagram or the paged decision log.
- Every chart deep-links to the board carrying its cohort filter (`boardHref`). `buildUrl`
  now keeps a `tab` **named in the patch** even when it equals the default, while one merely
  carried in `search` is still canonicalized away — previously these links shipped a filter
  with no destination (`app/features/shell/tabs.ts`, `tabs.test.ts`).
- The window switcher carries a scope line as its `aria-describedby` in three branches
  (all-time, so no deltas · a window selected · the section is window-blind).
  `WINDOW_BLIND_SECTIONS` names `quality`, where the pills grey to `opacity-50` but stay
  enabled. `/api/benchmarks` **takes no window, deliberately**: a short slice drops most orgs
  below the k-anonymity floor (`BENCHMARK_MIN_ENTRIES = 20` / `BENCHMARK_MIN_TEAMS = 2`,
  `app/_lib/db/org-benchmarks.ts`) and biases `medianTimeToHireDays` low by structurally
  excluding slow hires. `analyticsWindowScope.test.ts` fails if either half drifts.
- **Below the floor, `totalEntries` is withheld too when one team is the only contributor.**
  The aggregate excludes the caller's own workspace, so in a 2-team org exactly one team feeds
  it — and the whole payload crosses the wire even though the locked panel prints only
  `contributingTeams`. A volume is a team's figure once one team is behind it, so it is
  suppressed on the same condition the rates are and returns as a real aggregate at
  `contributingTeams >= BENCHMARK_MIN_TEAMS` (`org-benchmarks.test.ts`).

## Performance — a brief that refuses claims it cannot make

`sections/PerformanceBriefing.tsx`. Each band opens with a claim computed from the data; the
chart beneath is the evidence. Which claim the funnel band may make is one pure function,
`funnelBandState()` in `analyticsFunnelEmptyState.ts`:

| State | When | Renders |
| --- | --- | --- |
| `no-data` | `total === 0` | nothing has come through |
| `no-movement` | entries exist, **zero stage transitions** | `AnalyticsFunnelEmptyGuide` |
| `stalled` | a bottleneck cleared its min sample | the dwell claim |
| `weakest` | a stage is below **a goal the org set** | the weakest-link claim, naming the goal |
| `no-goal` | real conversion, no goal anywhere | "set a conversion goal and this brief will name your weakest stage" |
| `healthy` | every goal-bearing stage clears its goal | the healthy claim |

Precedence is the argument: movement licenses a conversion number at all, so it is checked
first; dwell keeps precedence over conversion; a goal is the last gate before the band may
call a stage weak.

- **Every band declares a no-data claim, structurally.** The brief's own rule ("if the data
  can't support a claim, the band says so plainly") is a table, not a habit:
  `performanceBands.ts` holds `BAND_NO_DATA_CLAIMS`, **total**, and `BandKey` is derived from
  it, so `Band` resolves its own fallback and a fifth band cannot be written without one. Each
  band is handed `hasData` — the **same predicate its panel uses for its own zero state**, not
  "is the payload loaded". `momentumIsQuiet()` and `hasRoleRows()` live in that module and are
  imported by both the band and the panel (`AnalyticsMomentumPanel`, `AnalyticsByRoleTable`), so
  the heading and the figure under it cannot disagree. Bands 3 and 4 previously rendered
  `briefMomentumClaim` / `briefRolesClaim` unconditionally, so an empty tenant read a claim
  about which roles pull the pipeline, in display type, directly above the first-run empty-state
  hero. The panels keep rendering in the no-data state: they own the honest empty copy
  (`momentumEmpty`, `AnalyticsEmptyPreview` and its two CTAs), and suppressing them to fix a
  heading would take away what an empty workspace needs. Every fallback says *not yet*; none
  fakes a zero. `performanceBands.test.ts` (6 checks) fails if a `<Band>` renders without
  `bandKey`/`hasData`, if `hasData` is a literal, if the rendered and declared sets differ, or if
  either panel stops using the shared predicate.
- **No verdict colour without an org goal.** `targets.conversion[stage] ?? 50` is gone from
  every funnel surface; a stage carries `met` / `missed` / `none` (`stageVerdict()`), and
  `none` renders in neutral `text-ink` with a `bg-stone-400` bar and no coral, plus a
  one-click path into `AnalyticsGoalsEditor` (optionally controlled via `open` /
  `onOpenChange`). The seeded tenant has `targets.conversion = {}`.
- **The zero-transition guard is on the render path** — `hasNoStageTransitions()` and
  `AnalyticsFunnelEmptyGuide` were correct, translated and reachable from nowhere. The review
  hatch `?funnelEmpty=1`, threaded through three files and destructured by no one, is
  **deleted, not honoured**.
- **`AnalyticsStageDwellPanel`** carries the three edges the consolidated funnel dropped:
  KO-gate discards before the first stage (`koDeclined`), `stageDwell` inside them (each row
  linking to that stage on the board), and the offer leg after the last
  (`AnalyticsOfferLegPanel`, honesty-gated below its min-offers floor). Dwell bars are one
  neutral tone scaled to the longest wait on screen: no org goal exists for per-stage dwell,
  so a colour would be a verdict nobody set.
- **The by-role table** (`AnalyticsByRoleTable.tsx`) puts a `ColumnFilter mode="search"` in
  the Role header, filters client-side, makes the CSV follow the filter, reports
  `{shown} of {total}` while searching and the server cap otherwise, and prints a cap note
  saying how many roles `BY_JOB_CAP = 12` dropped plus a board link. A search matching nothing
  says so **without claiming the role does not exist**.

## Economics — one comparison board

`sections/EconomicsBoard.tsx` puts three taxonomies (first-touch `bySource`, stored
`byChannel`, per-creative `byVariant`) into one sortable table with the same unit-economics
columns, **grouped and labelled, never merged**. A dash under Spend means "not measured for
this kind of surface", not "free", and the rule says so.

- **The spend write path is back.** Spend is an editable field on every channel row
  (`AnalyticsChannelSpendInput.tsx` → `POST /api/analytics/spend` → `setChannelSpend`), lifted
  into the board rather than restoring the deleted channel panel. A channel with recorded
  spend but **no attributed candidates still gets a row** (volume 0, per-unit figures `—`) —
  otherwise a stored figure divides into the blended cost-per-hire while being unreachable by
  any editor. `spend-write-path.test.ts` pins the chain.
- **Every money figure derived from a single stored row is dated.** Per-channel cost-per-hire
  carries `ChannelEconomics.spendUpdatedAt`; the blended figure in
  `AnalyticsComputeCostPanel.tsx` carries `costPerHireAsOf` and is labelled by its *oldest*
  input, because a blend is only as current as its stalest row.
- **One basis per per-hire figure.** `hiresClosedInWindow` counts entries whose **terminal
  transition** landed inside the window, matched by stage *role* (never the literal name
  "Hired"); `automationRoi` and `computeCost.costPerHireUsd` divide by it. `hired` keeps its
  creation-cohort meaning for the funnel and every cohort table; the two are equal all-time.
  `computeCost` also carries `windowDays` and `hires` and the panel prints them — the same
  ledger is read all-time here and 30-day in Billing.
- **`pctOfManualBaseline` is no longer capped at 100 %**: a ratio over 100 % is the signal
  that a denominator is wrong, and the cap rendered exactly that reading as believable.
  `manual_hours_per_hire` (`MANUAL_HOURS_TARGET_KEY`) joins `RESERVED_TARGET_KEYS`, and
  `POST /api/analytics/targets` derives its validator from that set, so a reserved key can no
  longer be readable but unsettable. `MANUAL_HOURS_PER_HIRE = 42` is the fallback anchor.
- **The section exits to Billing rather than inventing a per-decision number.** Under the
  compute-cost panel, a link built with `buildTabSwitchUrl` (the idiom the existing "Configure
  channels" exit uses) reaches **Settings → Billing**, with a note saying what Billing breaks
  down: the compute total here is one figure for the workspace, and Billing attributes it per
  use case. That answers "what / by whom / cost" by **navigation, not arithmetic** — no number
  is added, and the USD ledger and the CZK channel spend are still never converted, summed or
  compared. **A per-decision cost column stays declined**: `llm_usage.request_id` is not joined
  to pipeline events, so an unlabelled per-decision figure would be the LLM slice reading as the
  whole cost of the decision.

**The metric-pack contract is load-bearing** and unchanged (`app/_lib/metric-pack.ts`): every
metric carries `status` (`measured` / `thin` / `not_measurable`), `sample` and a `basis`
sentence stating what was counted, and a renderer must show the status beside the value;
`not_measurable` invents no number; `certifiable` is true only when every headline metric is
`measured`; `recruiter_hours_saved` is sampled in **actions, not hires**; the pack computes
**no "% improvement vs before"** (kp has no pre-kp baseline for a customer's process); each
figure keeps its own `unit`, so CZK spend and USD compute cost are never summed. The
spend-dating fix rides **inside** the existing `basis` string — nothing was added to the shape.

## Quality — calibration honesty

`sections/QualityInstrument.tsx` answers the question that comes before every decision below
it: should this score be allowed to decide at all.

- **Three producers, not two.** `GET /api/analytics/calibration?source=` serves `pipeline`
  (default) · `analysis` · `holdout` — the clean arm, which the route could already serve and
  no UI could reach. Each arm has its own "what this measures" / "what counts" copy.
- **Two axes, not one: which score, and what counts as success.** `?source=` picks the score;
  **`?outcome=advance|hired`** picks the outcome, and the response echoes the axis it actually
  applied. `advance` (the default, unchanged) counts positive anyone at or past the screening
  gate — interview, offer **or** hired — and negative a `rejected` still standing at a screening
  stage. `hired` counts positive the stage carrying the **terminal role** and negative a
  `rejected` who never reached it, **excluding everyone still in the process**, who may yet be
  hired. Both labels derive from stage *roles*, never the name "Hired":
  `calibrationAdvancedStages` slices at `screeningGateIndex` and `calibrationHiredStages` reads
  `stagesWithRole("terminal", axis)`, so a workspace that renames or splits a column still
  counts the same people. Vocabulary and guard: `CALIBRATION_OUTCOME_AXES` /
  `asCalibrationOutcome` (`app/_lib/calibration.ts`); producer:
  `pipelineCalibrationPairs(ws, { outcome })` (`app/_lib/db/pipeline.ts`); the memo key carries
  the axis (`calibrationCacheKey(ws, "<source>:<outcome>", family)`). Three constraints ride
  with it: **`?source=analysis` has no hire axis** — that producer pairs a recruiter
  *disposition* with no pipeline stage behind it, so a `hired` request falls back and the
  response echoes `outcome: "advance"` while the UI hides the selector and states why; **the
  threshold recommendation stays on `advance`**, because it defends a move of the *screening*
  floor with band advance rates, so `recommendation` is `null` on the hire axis and the panel
  names the axis it derives from; and **the score-band drilldown stays on `advance`**, because
  `pipelineCalibrationBandCandidates` labels candidates on that axis only. The hire axis needs
  only stage data and is **not** a hire-quality measure — the curve does not separate a hire
  from an interview, which the copy states rather than leaves to be inferred.
- **Leakage is per ARM (source × axis), not per source.** `calibrationLeakage(source, outcome)`.
  `pipeline` × `hired` carries its own descriptor, `code: "score-caused-rejects"`, at
  **`level: "high"`**. It is genuinely *better* than the advance arm — reaching a hire takes
  interviews, an offer and an acceptance, none of which the score decides, so the **positive**
  label was not produced by the score, and that is stated rather than assumed. The level does
  not drop, because the **negative** label still contains every auto-rejection the score
  produced: less circular is not clean. Keeping it `high` is also what keeps
  `calibrationVerdict.ts`'s structural bar applying to this arm — a high-leakage arm can never
  reach `trustworthy`, at any Brier.
- **Every arm states where its outcome label came from.** `calibrationLeakage()`
  (`app/_lib/calibration.ts`) returns a per-arm `{level, code, note, ceiling}` descriptor,
  now **rendered** as a tinted block *above* the curve it qualifies, in both the calibration
  panel and the Quality headline, from one shared component. Copy is localized off the stable
  `code`, never printed from the server's English `note`; a high-leakage arm offers a one-click
  switch to the clean arm.
- **A `level:"high"` arm can never be reported trustworthy.** `verdictFor()` lives in
  `calibrationVerdict.ts` — moved out of the `.tsx` so an *executing* test can pin it
  (`node:test` cannot import a `.tsx`, and a guarantee asserted by grep is the defect shape
  this round was about). The high-leakage branch sits **above** the skill ladder and returns a
  distinct `circular` verdict, so no Brier score can route a score-caused arm to
  `trustworthy`. `calibrationVerdict.test.ts` and `analyticsCalibrationLeakageGate.test.ts`
  assert the branch order and that exactly one path reaches `trustworthy`.
- **The yardstick is the cohort base rate, not a coin flip.** The `0.25` constant is gone;
  `calibrationSkill()` computes the base-rate Brier (`p(1−p)`, the constant "always predict the
  base rate" predictor) and the **Brier skill score** (`1 − brier/baseBrier`; 0 = no better
  than that guess, negative = worse). On a cohort that advances 86 % of the time that is the
  difference between "a comfortable margin over guessing" and a negative score.
- **Absences explain themselves.** The headline fetches `?source=pipeline` *and*
  `?source=holdout`; the holdout leads once it clears `minOutcomes`, and until then the
  pipeline arm leads with the `circular` verdict beside the holdout's accrual horizon. A null
  threshold recommendation renders `ThresholdSuggestionAbsent`, naming the gate it failed and
  stating this is absence of evidence, not endorsement of the current floor; an empty
  `familyFloors` map says every family screens at the global floor; a suggestion off a
  high-leakage arm carries its contamination caveat beside the Apply button.
- **The verdict states its scope, and reports the hire question separately.**
  `sections/QualityInstrument.tsx` reads both arms on the **advance** axis by construction, so
  its verdict is a claim about *advancing past screening*, with Interview / Offer / Hired as one
  label. That scope used to live only in the panel's small "what counts" line; it now prints
  under the verdict (`analytics.quality.scopeLabel` + `scopeAdvance`), and the headline
  additionally reads `?source=pipeline&outcome=hired` to report the hire question's own status
  (`hiredAxisReady` / `hiredAxisPending` / `hiredAxisWhere`). On the seeded host that arm is
  **n = 9 against a `minOutcomes` of 20**, so it prints its accrual horizon rather than an empty
  curve. The verdict vocabulary is untouched — `trustworthy` / `weak` / `untrustworthy` /
  `circular` / `unknown` — and the leakage bar above the skill ladder catches the new code for
  free, because it keys on `level`, not on `code`.
- **Quality of hire is stated as an accrual, not a curve.** A third line under the verdict reads
  `GET /api/pipeline/outcomes` and reports how many of the workspace's hires carry an on-the-job
  rating and how many more are needed before a curve could be judged — the same
  `MIN_CALIBRATION_OUTCOMES = 20` floor every other gate on the page quotes. A workspace with no
  hires is told so instead of shown a zero, and the line names where ratings come from (the
  candidate drawer on the hiring board — see [`../pipeline/README.md`](../pipeline/README.md)),
  so the horizon is actionable rather than a promise. The counter is operator-gated: a session
  that may not read it gets no line, rather than a zero that would read as "nobody worked out".
  **No `?source=performance` producer ships with it, and that is the point** — every clean arm
  on a fresh install is `n:0`, and a fifth empty arm would be the same "correct mechanism that
  reaches no surface" defect this round removed elsewhere. The capture path exists first; the
  arm follows when the corpus can say something.
- **Configuration is evidence about the policy; the curve is evidence about the sample.** Only
  the second needs a sample, so `ThresholdHistoryStrip` — the only surface rendering the sealed
  floor-over-time record with its approver and seal fingerprint — and `AnalyticsFamilyFloorChips`
  render **outside** the calibration gate. `AnalyticsCalibrationPanel.tsx` used to return the
  uncalibrated box and skip the whole measured branch, which contained both, so a workspace with
  a rich sealed policy history and 19 decided candidates saw none of it. `DriftStrip` and
  `ScoreBands` stay **inside** the gate: both are claims about the sample. The two policy
  surfaces remain **pipeline-source only**, deliberately — `currentThreshold` and `familyFloors`
  ship only on the pipeline payload, so the chips would otherwise print a global floor of `0`
  that nobody set, and the analysis arm measures a score the floor never acts on — but they show
  on **both outcome axes**, because the floor is a fact about the policy, not about which
  outcome the curve counts.
- `AnalyticsReliabilityDiagram.tsx` can draw the live auto-reject `threshold` and the
  `baseRate` as reference lines, with screen-reader equivalents — so a curve stepping from
  0.00 to 1.00 exactly at the floor reads as the score-caused signature it is.

## Quality — the audit trail

**Tamper-evidence, stated honestly.** `verifyDecisionChain()`
(`app/_lib/decision-record-store.ts`) returns a **key census** — `keyed`, `keylessCount`,
`firstKeyedSeq` — beside `ok`, and `AnalyticsDecisionRecordsPanel.tsx` conditions its badge on
it: broken (coral) · fully keyed (moss, verified) · mixed (moss verified **plus** an amber note
counting the links that predate the key and the `seq` from which protection begins) · never
keyed (amber — *integrity-evident, not tamper-resistant*). The reference deploy is the last
state: `KP_DECISION_HMAC_KEY` is unset, so every record carries `key_id = ''`, which each row
shows. The ceiling is on screen, not only in this doc: turning the key on later cannot re-seal
existing records, and protection begins at the first keyed one. The var, its key id and the
rotate-never-remove contract (`KP_DECISION_HMAC_KEY_<oldId>`) are documented in `.env.example`;
nothing about *what* is sealed moved. Full posture: `docs/features/compliance/README.md`.

**The auditor's row.** `sections/DecisionRecordsTable.tsx` is eight columns —
`# · Kind · Subject · Rationale · Actor · Sealed · Fingerprint · Key`. Subject gained search
and sort, **diacritic-folded** (so "cermak" finds Čermák) and ordered by `Intl.Collator` on the
app locale (so Č sorts after C, not after Z). `policyVersion` renders as a mono sub-line under
the kind, the truncated `contentHash` as a Fingerprint column with the full hash in `title`,
and kind labels are localized in the column *and* its filter menu. The rationale cell expands
into `sections/DecisionRecordDetail.tsx`: localized rationale, the sealed byte-stable English
labelled as *the text that is hashed* (only when it differs), policy version, full and previous
hashes, and the sealed instant in both rendered zone and raw ISO. That row also holds **"Export
this candidate's dossier"** — the first UI caller of `GET /api/decisions/records?candidate=`,
which had shipped a full cycle with none. Scoping is done by the route
(`listDecisionRecords({ candidateRef })`), never by filtering a whole-workspace read client-side.

**AI Act Art. 12 traceability, read back.** A record sealed by a group evaluation
(`group_eval_lead` / `group_eval_advisory`) also answers *which prompt produced the reasoning*
and *what the model said about the candidate it ranked first*. Both are sealed into `inputs` at
seal time by `app/_lib/group-eval-run.ts`; `parseSealTraceability`
(`app/_lib/decision-attribution.ts`) reads them back — this is its **first production caller**,
the parser having shipped with none — and `DecisionRecordDetail` renders the prompt version(s)
as chips and the lead's verdict, strengths and gaps **verbatim**. It is evidence, so it is never
summarised or re-narrated. Three honest absences, never a blank: a seal carrying neither half
(every record written before W0.3) says so in one sentence naming both possible causes; a seal
with a prompt version but no model text says that; a run with no LLM behind it reports an empty
prompt version as *not recorded* rather than implying one. The parser returns `null` instead of
an empty shell precisely so those states stay distinguishable, and the block renders on
group-eval kinds only (`kind.startsWith("group_eval")`) — a "not recorded" line on an advance or
an offer would claim a compliance gap that does not exist. Pinned by
`sections/sealTraceabilityRender.test.ts` (5 checks). Posture:
`docs/features/compliance/README.md`.

**`decision_records` has no seed snapshot and cannot have one.** The chain accretes at runtime
and each link hashes the one before it, so a checked-in fixture would either ship hashes the
first real seal invalidates, or have to be written into an existing chain — which is the
tampering the chain exists to detect. The six group-eval records in the seeded workspace predate
W0.3 and **must stay that way**: rewriting them to make the demo look better would forge an
audit record, and the panel would correctly report the chain as broken. Top the corpus up by
**appending** a real evaluation instead:

```bash
node scripts/seed-group-eval-seals.mjs [--base-url http://localhost:3001] [--dry-run] [--timeout-ms 120000]
```

It is **not wired into `package.json`** — invoke it with `node`, as above (it also honours
`KP_BASE_URL`). It drives the same `POST /api/tasks {kind:"group_eval"}` the Decisions modal
does, so the seal is produced by the live writer over real cohort data and nothing is fabricated
(keyless, the reasoning is the deterministic ranker's and `promptVersion` is honestly empty).
It needs a running server against the DB being topped up, and it is idempotent: it exits without
acting when any group-eval record already carries traceability.

`sections/DecisionLogTable.tsx` gains the same subject search, **server-side** because the trail
is server-paged, sharing the fold and collator helpers with the records table, plus a
**whole-trail CSV export** beside "Export page" — a failure downloads **nothing** rather than a
partial file named "whole trail". The refined read path exists because SQLite's BINARY collation
can do neither job: when `q` is set, or the sort column is `candidateLabel`/`jobTitle`, the
handler reads the filtered set newest-first, folds and collates in JS, then slices the page and
enriches only that slice. It is a **scan bound, not a date window** — `SUBJECT_REFINE_MAX = 5000`
is disclosed via `subjectScan.capped`, above which the table states which most-recent N decisions
of how many were searched.

**One clock, named.** Both tables render through `formatAuditTime(iso, locale, zone)`
(`analyticsDecisionLogTypes.ts`) where the zone is the reader's resolved time zone, print
`Times in {zone}` beside the count, and keep raw ISO in each cell's `title`. The CSV carries
**both** a rendered `Time ({zone})` matching the screen and `Time (ISO, UTC)` for the machine;
previously the screen showed an unmarked UTC instant while the export wrote true ISO, so the two
disagreed by the offset on an audit artifact.

**Every export names its own scope.** The log CSV opens with a provenance block
(`Export · Generated · Time zone · Language · Scope · Filters`), a blank separator row, then
header and body. The records JSON carries a machine-named `provenance` object (`artifact, scope,
generatedAt, timeZone, locale, recordCount, chainScope, chainVerified, chainKeyed,
chainKeylessCount`). `chainScope` is `workspace` even inside a one-subject dossier, deliberately
— the verdict always covers the whole chain, so a reader cannot report "chain verified" as a
statement about one candidate — and the chain export ignores the table's filters, because a
filtered chain cannot be re-verified.

**Every decision kind is mapped.** Deriving the guard instead of copying it surfaced **17**
written-but-unmapped kinds, all badging UNKNOWN, in neither filter, in no rollup.
`DECISION_META` (`app/_lib/decision-attribution.ts`) now holds 62 kinds, 36 auto / 26 human, and
attribution fails *away from the machine*: `human_round_queued` (the human-oversight hand-off)
and `stage_migrated` credit the human, because the accountable act is the operator's. The two
retired onboarding kinds are **mapped, not filtered** — the module is gone, but their rows sit in
deployed databases, and a trail that hides rows it no longer has a writer for is worse than one
that labels them; they are declared in `RETIRED_EVENT_KINDS` and labelled "(retired module)" in
all four locales. `decision-attribution.test.ts` derives its drift guard three ways instead of a
hand-copied list: a **source scan of the writers** across `app/` with a non-vacuity floor,
`DECISION_META` pinned **set-equal** to `EVENT_KINDS`, and `RETIRED_EVENT_KINDS` asserted
still-mapped and still writer-less. A further test fails if either attribution bucket crosses
`EVENT_KIND_FILTER_MAX = 64`, which `app/_lib/db/pipeline.ts` truncates silently.

**The two filters intersect.** The table sends `kind` and `attribution` together and the route
resolves them through the pure `resolveDecisionKindFilter()`. A contradictory pair returns
`matchesNothing` and the route answers an empty page **without touching the store** — necessary
because `eventKindClause` reads an empty kind list as *unfiltered*, so the naive fix would turn
"narrowed to nothing" into "here is the whole trail".

**A decision can carry a name.** `app/_lib/auth/operator-approver.ts` keeps `operatorApprover()`
as the honest **fallback** and adds three server-bound async resolvers above it:
`approverIdentity()` (the signed-in person's name, else email, from `currentUserId()` +
`app/_lib/db/users.ts`, or `null`), `resolveApprover()` (that name, else the fallback — the
Art. 22 approver sealed into a record) and `humanActor()` (`"human:<Name>"`, else the role token
`"human:recruiter"`). The name comes from the signed session cookie, never a request body.
**Open/keyless dev is unchanged by design**: no cookie ⇒ no `sub` ⇒ the fallback, so a
single-operator deployment still reads "operator (single-operator deployment)".

`pipeline_events` gains a nullable **`actor`** column (`app/_lib/db/core.ts`), additive and
idempotent in both the `CREATE TABLE` and the ALTER list, carrying the decision-chain vocabulary
(`auto:<engine>` / `human:<Name>` / `human:recruiter` / NULL). **There is no backfill,
deliberately** — nothing records who decided the legacy rows, and defaulting them to the operator
would manufacture the accountability the work exists to make real, so legacy rows stay
unattributed on purpose. `app/_lib/pipeline-entry-action.ts` resolves ONE `sealActor` per action
and gives it to the event row, the sealed record and the offer seal. `actor` reaches
`/api/analytics/decisions` and `/api/pipeline/events` and is **omitted** from
`toPublicPipelineEvent`'s allowlist, so an unauthenticated reader never learns which staff member
decided what. The sealed adverse rationale renders the approver through `waveReasonText` — the
one resolver shared by the reconsider queue, the records panel and the log — appending "Approved
by {who}" or "Approver not identified": silence and "approved by nobody in particular" read
identically to an auditor.

**Why the two lists sit on opposite sides of the table kit.** The log sorts and pages on the
**server** (`?sort=`/`?dir=`/`offset`), because the trail must stay reachable in full and sorting
the 20 rows on screen would look like ranking the whole trail; the records sort and page on the
**client**, because `/api/decisions/records` returns the whole chain anyway. Server ordering
lives in `listPipelineEvents` (`app/_lib/db/pipeline.ts`) behind `EVENT_SORT_COLUMNS`, an
**allowlist** — the column lands in `ORDER BY`, where a binding cannot stand in for an
identifier, so the guard *is* the injection defence — and every ordering appends `id DESC` as a
stable tiebreak. The records table keeps `seq` visible in every ordering, so a re-sorted **view**
is never mistakable for the chain (`db/pipeline-events-sort.test.ts`,
`e2e/quality-tables.spec.ts`).

## The render map is pinned, not assumed

`analyticsRenderMap.test.ts` exists because the section consolidation **kept the machinery and
dropped the wiring**: nine modules stopped being rendered and several payload fields kept being
computed on every request with no reader, and not one produced a test failure, a type error or a
lint warning. A panel that compiles, translates cleanly and is imported by nobody is invisible to
every gate this repo runs — `analyticsSections.test.ts` pinned the section *vocabulary*, and
nothing pinned the render *map*.

It walks the import graph from `AnalyticsTab` and fails on (1) an unreachable module under
`app/features/insights/analytics/**`; (2) a `sectionChunks` export no section imports —
declared-vs-imported is the ratio that answers "is this rendered anywhere", which is why three
reviewers reported the same defect as "33 panels", "35" and "40 clean + 9 orphaned"; (3) a
top-level `Analytics` payload field with no `data.<field>` reader in any reachable module — the
half a graph walk cannot see; and (4) a stale allowlist entry. Two properties keep it from being
gamed, both asserted against a synthetic graph inside the file: the walk is **transitive** from
the real entry point, so a module imported only by another orphan stays unreachable; and the
barrel is walked **by export name, not as a file**, because `sectionChunks` dynamically imports
every panel it declares, so a file-level walk would call an unimported chunk "reachable" and miss
exactly the defect that hid the only write path to `channel_spend`. `STAGED_WIRES` /
`STAGED_DELETES` / `STAGED_FIELDS` are staged work, not exemptions — each names the edit that
clears it and **fails the moment that edit lands**. All three are empty today.

The triage it drove: `AnalyticsFunnelPanel`, `AnalyticsForecastPanel`, `AnalyticsSourcePanel` and
`AnalyticsChannelEconomicsPanel` were **deleted**, each superseded by the funnel band, the "what
is coming" band, or the board's `source` / `channel` row groups with the spend editor lifted in.
`AnalyticsOfferLegPanel` and `AnalyticsArchetypePanel` were **restored** into the Performance
brief.

## Vocabulary: "confidence" was four quantities

One word covered four unrelated numbers on scales **inverted against each other** (for a salary
read "high" means certain; for a match band "tight" does). Each now has its own word at every
render site, in all four locales:

| Quantity | What it is | en |
| --- | --- | --- |
| Measurement interval (`match.band.*`) | how far the score could move given how thin the evidence is | **Score range** |
| LLM self-report (Decisions AI review card) | the model's own rating of its own verdict | **Self-reported by the model** |
| Salary-read grade (`report.confidence.*`) | how strong the evidence behind the read is | **Strong / Moderate / Weak evidence** |
| Archetype vote share (`registry.detect`) | the winner's share of the routing-signal weight | **signals agree** |

**The self-report no longer renders with measurement grammar.** The 0–100 scalar used to be a
tinted meter under the word "Confidence", announced as "AI confidence in this recommendation:
87 %" — all grammar this app reserves for measured quantities. `DecisionsAiReviewCard.tsx` now
renders three lines of plain text, disclosure first: a label naming the *author* of the number,
the value, and a sentence stating nobody has compared it against real outcomes. Plain text needs
no `aria-label`, so the assertive `role="img"` is deleted rather than reworded, and `RecBadge` no
longer re-prints the number as a suffix; `decisionsAiReviewCardLogic.ts` exposes one
`modelSelfReport` and the tone is deleted, not renamed. The measured sibling — how often a score
in this band actually advances — is a **cohort** statistic and stays with its cohort in the
calibration surface. `app/features/insights/matrix/focus/MatchCard.tsx` likewise stopped rendering
its score bare: a provenance chip from the shared `scoreProvenance` catalog names the three
producers in `app/_lib/match-score.ts` — `analysis` (saved CV analysis), `snapshot` (the
add-to-pipeline stamp) and the new `freshMatch` (this match run). Guarded by
`app/features/shared/confidence-vocabulary.test.ts` in three halves: executing over the card
logic, source-level over the `.tsx`, and catalog-level asserting the four render strings share no
collided stem in any locale and that the self-report label names the model in all four.

## API surface

| Route | Serves |
| --- | --- |
| `GET /api/analytics` | The main payload (`AnalyticsTypes.ts` → `Analytics`); `?days=30\|90` scopes the cohort window, absent = all time; `deltas` is `null` all-time |
| `GET /api/analytics/decisions` | The paged decision log. `?kind=` + `?attribution=` **intersect**; `?q=` subject search (diacritic-folded, ≤80 chars); `?locale=` picks the collator; `?sort=`/`?dir=`/`offset`/`limit`; returns `subjectScan` |
| `GET /api/analytics/calibration` | Band calibration + reliability; `?source=pipeline\|analysis\|holdout`, `?outcome=advance\|hired` (echoed back; `analysis` always falls back to `advance`), `?family=` |
| `POST /api/analytics/calibration/apply-threshold` | Commit a suggested threshold (`requireOperator()`) |
| `GET /api/analytics/calibration/band` · `/threshold-history` | Band detail (`?bin=`/`?source=`/`?roleFamily=` — **no `?outcome=`**, so the drilldown is advance-axis only); the sealed floor-over-time strip |
| `GET\|POST /api/analytics/spend` | Per-channel spend; written back by the board's inline input |
| `GET\|POST /api/analytics/targets` | Conversion goals + reserved keys (`time_to_hire`, `recruiter_hourly_czk`, `manual_hours_per_hire`), validated from `RESERVED_TARGET_KEYS` |
| `GET /api/analytics/metric-pack?format=md` | The buyer metrics as JSON or a one-page Markdown pack; `?days=` optional |
| `GET /api/decisions/records` | The whole sealed chain + verdict; `?candidate=<entryId>` scopes to one subject (`requireOperator()`) |
| `GET /api/benchmarks` | Cross-workspace company benchmark. **Takes no window parameter** |
| `GET /api/pipeline/outcomes` | Not an analytics route — it belongs to the board — but Quality reads it for the hire-rating accrual counter `{ rated, hires, minOutcomes }` (`requireOperator()`). Capture side: [`../pipeline/README.md`](../pipeline/README.md) |

Pure computation lives beside the route, not in it: `analytics-forecast.ts`,
`analytics-momentum.ts`, `analytics-deltas.ts`, `analytics-bottleneck.ts`, `analytics-offer.ts`,
`analytics-cache.ts`, `automation-roi.ts`, `metric-pack.ts`, `calibration.ts`,
`decision-attribution.ts` — each with a colocated `.test.ts`. On the client,
`calibrationVerdict.ts` and `analyticsFunnelEmptyState.ts` hold the two render decisions that had
to become executable values. Tables compose `app/_components/table/` (`TablePager`,
`ColumnFilter`, `ColumnHead` + `useTableSort`, nulls last in both directions).

## Data model

Read-only over the operational tables, plus three the tab writes:

| Table | Role |
| --- | --- |
| `pipeline_entries`, `pipeline_events` | Funnel, dwell, momentum, decision log. `pipeline_events.actor` is nullable and never backfilled |
| `decision_records` | The per-tenant hash chain: `seq`, `prev_hash`, `content_hash`, `kind`, `actor`, `policy_version`, `candidate_ref`, `rationale`, `reason_code`, `payload_json`, `created_at`, `key_id` |
| `analytics_targets` | Recruiter-set goals: per-stage conversion %, plus reserved `time_to_hire`, `recruiter_hourly_czk`, `manual_hours_per_hire` |
| `channel_spend` | Per-channel spend with `updated_at`, read via `listChannelSpendDetail()` in `app/_lib/db/channels.ts` (`listChannelSpend()` survives for amount-only callers) |
| `llm_usage` | The compute-cost ledger (account-wide — see Known gaps) |

Payload additions this round: `ChannelEconomics.spendUpdatedAt`, `costPerHireAsOf`,
`hiresClosedInWindow`, `computeCost.windowDays` / `.hires`, and the `leakage` descriptor on both
calibration payload types.

## Honesty rules this surface keeps

Load-bearing, not stylistic: an unknown cost renders as `—`, never `$0` ("free" and "unpriced"
are different facts) · no verdict colour without a goal the org set · a ratio over 100 % is shown,
not capped · the forecast refuses to project below its signal floor (`forecastHires().hasSignal`)
· capped tables say what they dropped and where to reach it · the first-run empty state previews
the metrics with literal em-dashes and never fabricates sample figures
(`AnalyticsEmptyPreview.tsx`) · a tamper-evidence claim is conditioned on the key census.

## Every stage threshold reads the workspace's own board

`pipelineAnalytics` resolves the axis once (`getPipelineAxis(workspaceId).stages`) and every
threshold on the page must be asked against THAT axis, never the shipped five names — a
predicate called without it indexes a renamed column to `-1` and answers a confident zero.
Two call sites were still doing that and are pinned by `analytics-custom-axis.test.ts`:

| Metric | Reads | Failure when the axis was omitted |
| --- | --- | --- |
| `byArchetype.advanceRatePct` | `hasAdvancedPastScreening(stage, axis)` | the equity headline read a flat **0 %** on any renamed board, while `byJob.reachedInterview` — documented as the same threshold over the same cohort — counted correctly |
| `momentum[].hired` | `weeklyMomentum(…, { terminalStage })` | terminal transitions landed in the `advanced` bars and the hire series sat at **0** forever |

## Known gaps

- **A hire recorded by the agent bridge is invisible to every event-time hire metric.**
  `app/api/agents/report/[token]` and `app/api/agents/[id]/refresh` reach the terminal stage
  through `setPipelineEntryStage`, which writes `kind = "moved"` (and hardcodes the name
  `"Hired"`). `hiresClosedInWindow` and `weeklyMomentum` both count only
  `advanced` / `auto_advanced`, so such a hire raises `hired` (the snapshot cohort) but not the
  event-time denominator — inflating `computeCost.costPerHireUsd` and
  `automationRoi.hoursSavedPerHire` by the share of bridge hires in the window.
- **The score-bands drilldown and the threshold recommendation are advance-axis only.**
  `GET /api/analytics/calibration/band` takes no `?outcome=`, so `ScoreBands` is offered on the
  advance axis and `outcomeHiredScopeNote` explains its absence on the hire axis; the
  recommendation is `null` there for the same reason. A hire-axis drilldown needs
  `pipelineCalibrationBandCandidates` to label on the second axis first.
- **The hire arm sits below its minimum-outcomes floor on real data.** On the seeded host it is
  n = 9 against `MIN_CALIBRATION_OUTCOMES = 20` (6 hires and 3 screening rejections, with 48
  scored candidates still in the process and therefore excluded), so it prints an accrual
  horizon and no curve. That is the correct answer, not a defect — but it means the axis is
  currently a mechanism with no measurement behind it on any workspace this size.
- **No calibration producer is paired against the on-the-job rating.** The capture half of
  quality-of-hire ships (`POST /api/pipeline/outcomes`); there is no `?source=performance` arm,
  so nothing yet measures the score against how a hire actually worked out. Deliberate — the
  corpus accrues first — and the accrual counter on Quality is the horizon.
- **Nested payload fields are outside the render-map guard's grain.** It checks top-level
  `Analytics` fields, so `deltas.bySource` / `deltas.byChannel` and the `ChannelEconomics` columns
  the board does not carry (`costPerApplicantCzk`, `medianHoursToDecision`) are still computed on
  every request with no reader.
- **A candidate *filed* at a stage is indistinguishable from one *moved* there.** The payload
  carries reached/current counts but no transition count, so on a workspace whose candidates all
  arrive already-screened and never move, `hasNoStageTransitions()` reads movement. Pinned as a
  `KNOWN GAP` test in `analyticsFunnelGuard.test.ts`.
- **The log's subject search is local state, not deep-linkable.** Only `?kind=` syncs to the URL;
  `q` is already a tab-scoped param the pipeline board owns, so a shareable log search needs a
  distinct param name.
- **`manual_hours_per_hire` is settable via the API but has no input in the UI**, so the ROI
  percentage is still measured against the shipped 42-hour constant. It belongs beside the
  recruiter-hourly field in `AnalyticsAutomationPanel.tsx`.
- **The log's *who* column still renders a class, not a person** — it derives `auto`/`human` from
  `DECISION_META`, and `parseEventActor()` has no UI consumer.
- **`byJob` is volume-capped server-side** (`BY_JOB_CAP = 12`); the search filters the 12 rows the
  payload carries, and row 13 is reachable only via the board link. Any design that RANKS roles
  here needs the cap lifted or the ranking done server-side, or it can hide its own leader.
- **Several `confidence*` catalog keys are now orphaned** —
  `decisions.aiReview.confidenceLabel` / `confidencePct` / `confidenceAria`,
  `analytics.decisionRecords.export`, and `SCREENING_CONFIDENCE_BAND` in
  `app/features/shared/decisionsTypes.ts`. Parity-safe (`i18n:check` gates parity, not usage).
- **The i18n em-dash gate only inspects scalar leaves.** `flatten()` in `scripts/i18n-check.mjs`
  stores an array as one value and `dashError()` returns null for non-strings, so array-valued
  messages escape the rule.
- Per-tenant `llm_usage` attribution is not built, so compute cost is account-wide (see
  `docs/architecture/llm-provider-layer.md`).
