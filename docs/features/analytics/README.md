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

### The three write doors check a ROLE, not just a session (2026-09-03)

`requireOperator()` answers "is there a valid, non-demo session" — it reads no role
(`app/_lib/auth/require-operator.ts`). So every seat on the team, `viewer` included,
could move the live auto-reject floor; and `POST /api/analytics/spend` and
`POST /api/analytics/targets` carried no gate at all. All three now additionally require
**`pipeline:write`** (`can()` in `app/_lib/auth/current-user.ts`) — the capability that
already gates the rest of the recruiter's decision surface. A `viewer` holds `read` only
and is refused **403 `ANALYTICS_POLICY_FORBIDDEN`**; no session is still 401.

`apply-threshold` also stopped treating the operator's consent as optional.
`suggestedThreshold` — the number the panel showed — is now **required**: it used to be
compared only `if (typeof body.suggestedThreshold === "number")`, so a POST that omitted
it skipped the staleness comparison entirely and applied whatever the live recommendation
had become. The four outcomes are now distinct codes rather than one prose sentence:

| Outcome | Status | Code |
| --- | --- | --- |
| No `suggestedThreshold` in the body | 400 | `CALIBRATION_SUGGESTION_REQUIRED` |
| A `roleFamily` the app does not define | 400 | `CALIBRATION_FAMILY_UNKNOWN` |
| Nothing to apply (the honesty gates closed) | 409 | `CALIBRATION_RECOMMENDATION_ABSENT` |
| The live recommendation moved (carries `recommendation`) | 409 | `CALIBRATION_RECOMMENDATION_CHANGED` |

`AnalyticsThresholdSuggestion.tsx` resolves the code through `useErrorMessage()`, so
"the recommendation changed under you" and "the write fell over" no longer render the
same red line. Pinned by `app/api/analytics/analytics-writes-authority.test.ts`.

### Three expensive reads carry a per-IP budget

`metric-pack`, `decisions` and `calibration/threshold-history` spend CPU and the shared
SQLite connection rather than provider credit, which is why they had no limiter — and the
metric pack hangs off a **download link**, which a browser or a prefetcher can pull with
no click. Each now calls `rateLimit()` after its cheap refusals, answering
`TOO_MANY_REQUESTS` (429): metric-pack 30/10 min, decisions 120/10 min (the log pages 20
at a time on scroll), threshold-history 60/10 min. Pinned in
`app/api/rate-limit-contract.test.ts`.

`threshold-history` stays ungated by role deliberately — it returns policy-level seals
(`policy:screening:*`, no candidate PII) and aggregate band rates, the same exposure class
as the `/calibration` reads beside it. That is precisely why it needed a budget.

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
  (all-time, so no deltas · a window selected · the section is window-blind). The brief's
  lede chips gate on `Delta.delta != null`, not on the `Delta` record: the record always
  exists in a windowed view, but a prior window with no candidates yields a null hire-rate
  delta (`analytics-deltas.ts` returns null, never `0 %`), and `DeltaChip` renders nothing
  for it — so keying the label off the record left a bare "Hired" with no figure beside it.
  `WINDOW_BLIND_SECTIONS` names `quality`, where the pills grey to `opacity-50` but stay
  enabled. `/api/benchmarks` **takes no window, deliberately**: a short slice drops most orgs
  below the k-anonymity floor (`BENCHMARK_MIN_ENTRIES = 20` / `BENCHMARK_MIN_TEAMS = 2`,
  `app/_lib/db/org-benchmarks.ts`) and biases `medianTimeToHireDays` low by structurally
  excluding slow hires. `analyticsWindowScope.test.ts` fails if either half drifts.
- **Every benchmark figure is localized.** `interviewRatePct` / `hireRatePct` /
  `medianTimeToHireDays` run through `useNumberFormat().grouped` and the
  `orgBenchmark.pctValue` / `orgBenchmark.dayValue` catalog units, so the day suffix is
  `d` / `d` / `T` / `j` per locale rather than a hard-coded English `d`. The team figure
  uses the shared `STAT_VALUE` recipe.
- **Below the floor, `totalEntries` is withheld too when one team is the only contributor.**
  The aggregate excludes the caller's own workspace, so in a 2-team org exactly one team feeds
  it — and the whole payload crosses the wire even though the locked panel prints only
  `contributingTeams`. A volume is a team's figure once one team is behind it, so it is
  suppressed on the same condition the rates are and returns as a real aggregate at
  `contributingTeams >= BENCHMARK_MIN_TEAMS` (`org-benchmarks.test.ts`).
- **The caller's own side of the comparison needs a denominator too.** `statsFrom()`
  short-circuits an empty team to `interviewRatePct: 0` / `hireRatePct: 0` while only the
  median is honestly `null`, so a team with zero pipeline entries used to render `0 %` against
  the org average and wear a coral **behind** chip on both rates — a verdict computed over
  nothing, read by a new team on its first visit to an established org.
  `AnalyticsOrgBenchmarkPanel` now gates both team rates on `team.totalEntries > 0` and renders
  the same em-dash the median already used, with no verdict chip.

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
  The same rule now covers the **time-to-hire goal pill** in the header stat cluster
  (`AnalyticsStat` → `goalChip`): its copy is only `goalDays` („goal 30 d") — no verdict word —
  so the colour *is* the verdict, and `missed` is therefore `boolean | null`. `null` = **not
  measured** and renders neutral (`bg-stone-100 text-steel`). It used to be
  `avgTimeToHireDays != null && avg > goal`, which collapsed "no hires in this window" onto
  `false`, i.e. onto the **met** colour: a green "goal 30 d" beside a `—` and „no hires yet".
  A goal is not met by a cohort that produced no measurement.
  The rule is a pure module now — `timeToHireGoalChip()` (`statGoalChip.ts`, executed by
  `statGoalChip.test.ts`) — because a verdict expressed only as a colour cannot be asserted by
  reading JSX. Same move for the dwell band's whole-band gate and bar scale
  (`stageDwellGate.ts` / `stageDwellGate.test.ts`).
- **The headline average names its sample.** The time-to-hire tile prints
  `daysAvgOver` — "days avg over N hires" — from `timeToHireSamples`, NOT from `hired`: a hire
  whose entry lacks one of the two timestamps is a real hire the mean cannot see (4 of 9 on the
  shipped corpus). In a windowed view the hired tile adds `closedInWindowSub` when
  `hiresClosedInWindow` differs from `hired` — the event-time basis every per-hire figure on
  the tab divides by, so the two counts no longer disagree silently. Every figure in the
  cluster is grouped in the reader's locale (`useNumberFormat`), and the tile composes the
  `STAT_VALUE` recipe instead of re-typing it (the hand-typed copy had already lost `nums`).
- **A failed goal save says which failure it was.** `AnalyticsTargetInput` threw a bare
  `new Error()`, so a seat refused by policy (`ANALYTICS_POLICY_FORBIDDEN`) and a write that
  fell over (`ANALYTICS_TARGET_SAVE_FAILED`) were one coral border and one keyboard-unreachable
  tooltip — on the surface that sets the goal lines every figure here is judged against. It now
  resolves the route's code through `useErrorMessage` and announces the failure
  (`announceFailure`), exactly like the spend input; the fold both share is
  `localizedSaveFailure()` (`analyticsSaveFailure.ts`).
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
  says so **without claiming the role does not exist**. Its hire-rate cell carries the same
  two-part guard the economics board uses: `total === 0` renders `—` (a role that exists in the
  table only because it has KO-gate discards — `db/analytics.ts` seeds `jobMap` from `koByJob`
  — has no cohort, and the server's `hireRatePct: 0` for it is an undefined ratio, not a
  measured one), and the `text-moss` "this converts" colour is reserved for `hired > 0`. The
  CSV carries the same dash, so the file cannot disagree with the screen.

## Economics — one comparison board

`sections/EconomicsBoard.tsx` puts three taxonomies (first-touch `bySource`, stored
`byChannel`, per-creative `byVariant`) into one sortable table with the same unit-economics
columns, **grouped and labelled, never merged**. A dash under Spend means "not measured for
this kind of surface", not "free", and the rule says so.

- **The attribution model is FIRST-TOUCH and IMMUTABLE AT INTAKE — and now says so.**
  Every per-source, per-channel and per-creative figure on this board rests on one rule that
  had never been written down anywhere: an entry's `source_channel` / `source_campaign` /
  `source_variant` are stamped **once, by whichever door the candidate first arrived
  through**, and nothing relabels them afterwards. A second reach-out, a re-add from the
  sourcing surface, a later apply on the same job — each is idempotent and each leaves the
  original attribution standing (`app/_lib/sourcing-attribution.test.ts` pins exactly that:
  the round-trip AND the no-relabel). So the board answers *"which door did this hire come
  in through?"*, never *"which touch converted them?"* — there is no multi-touch weighting,
  no last-touch override and no decay, and a campaign that re-engaged a candidate sourced
  elsewhere gets no credit here by construction. That is a deliberate choice (a first-touch
  number an operator can audit against one row beats a model they cannot), but reading a
  variant table as *influence* rather than *origin* over-credits whichever channel happens
  to find people first.
- **Campaign and variant are capped at intake, truncated with a visible marker.** They are
  untrusted third-party free text that becomes both a recruiter-visible label and the
  group-by key `variantRowKey(jobId, campaign, variant)` builds a funnel row identity from.
  `extractLead` (`app/_lib/lead-payload.ts`) caps each at `MAX_ATTRIBUTION_LENGTH` = 120
  **code points** and appends an ellipsis, so a cut value is distinguishable from a genuine
  120-character name; the lead itself is never refused over it. The cap sits at intake
  rather than at each consumer, and matches the slice `inbound-lead.ts` already applied (a
  test fails if that constant ever drops below it). Two campaigns sharing a 119-character
  prefix still collapse into one row — inherent to any cap, and now at least visible.
- **One median, one stated policy.** `medianHoursToDecision` here, `medianTimeToHireDays` on
  the ROI ledger, the model matrix' p50 and the fit matrix' column median were four separate
  implementations that disagreed on even-count ties and on invalid samples. They now share
  `median()` in `app/_lib/stats.ts`: non-finite samples dropped (never sorted into the
  middle), an empty sample `null` and never `0`, even counts the **mean of the two middles**,
  and the result exact — each surface applies its own precision (0.1 h here, whole days on
  the ledger, a band-safe floor on the matrix) and says why.
- **The tab holds no recipe debt.** Every `app/features/insights/analytics/**` row is
  gone from `app/_components/ui/recipe-debt.json`: the last one, the role-only actor badge
  in `sections/DecisionRecordsTable.tsx`, composes `NOTICE("amber")` like its siblings.
  The header's copy-link confirmation timer is also cleared on unmount, so a copy followed
  by a tab switch no longer wakes a setState on an unmounted component.
- **The spend write path is back.** Spend is an editable field on every channel row
  (`AnalyticsChannelSpendInput.tsx` → `POST /api/analytics/spend` → `setChannelSpend`), lifted
  into the board rather than restoring the deleted channel panel. A channel with recorded
  spend but **no attributed candidates still gets a row** (volume 0, per-unit figures `—`) —
  otherwise a stored figure divides into the blended cost-per-hire while being unreachable by
  any editor. `spend-write-path.test.ts` pins the chain.
- **A failed spend write says which failure it was, out loud.** The editor resolves the
  route's code (`ANALYTICS_POLICY_FORBIDDEN` 403 / `ANALYTICS_SPEND_SAVE_FAILED` 500) through
  `useErrorMessage()` and throws a `LocalizedFailure`; `AnalyticsInlineNumberSave` renders it
  in a `role="alert"` line beside the field (`announceFailure`, opt-in — the goals editor
  keeps the border-only report in its tight label/input/suffix row). Previously a bare
  `new Error()` made a policy refusal and a store outage the same coral outline plus a
  keyboard-unreachable `title` tooltip.
- **The save decision is a pure module.** `inlineNumberSavePlan.ts` owns the locale-aware
  parse, the zero-is-no-value rule, the unchanged short-circuit and the canonical re-seed,
  so `inlineNumberSavePlan.test.ts` EXECUTES them instead of reading the `.tsx` for them.
- **A typed `0` is a clear, and the field now says so immediately.** `setChannelSpend` and
  `setAnalyticsTarget` both DELETE the row when `!(v > 0)` and the routes still answer 200, so
  zero is never a stored value. `AnalyticsInlineNumberSave` mirrors that rule before it posts:
  it normalizes a non-positive draft to `null` and re-renders the field from what will actually
  be stored. Previously, typing `0` over an empty field left `0` sitting in the input for the
  rest of the session — the server value stayed `null`, so the prop-resync never fired — while
  the column it feeds went on showing `—`. On these surfaces a dash means "not measured", and
  the editor has to agree with it. It also strips **every** space before parsing, not just the
  outer ones: the figure beside the input is rendered by `formatGrouped`, which groups with
  U+00A0 in `cs` and U+202F in `fr`, so typing back the number on screen used to hand `Number()`
  a `NaN`. A space is a group separator in all four catalogs and a decimal separator in none;
  the `en` comma and the `de` period are deliberately **not** normalized (see Known gaps).
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

**A count is not a page.** `recruiter_capacity`'s `openRoles` term is `listCorpusJobs(ws).length`
— the unbounded read whose predicate (`status IS NULL OR status = 'published'`) already *is* the
open-role definition the route wants, and the same one `openOnly` / `isJobOpenForApplications`
use. It was a `.filter()` over `listJobs({}, ws)`, the paginated **browse** read: no `limit`
means `LIMIT 300` (a supplied one caps at 500), so a workspace carrying more visible openings
than that had its capacity numerator silently truncated to the cap and shipped as `measured` in
the pack. Identical on the seeded corpus (100 either way); it only diverges above the cap.

**…but the count is still the wrong TIER (open).** `listCorpusJobs(ws)` enumerates the dual-tier
predicate `workspace_id IS NULL OR workspace_id = ws`, and the ~100 seeded rows every tenant
matches against are `workspace_id IS NULL`. So on the shipped database a workspace that has
authored **zero** live roles and carries one recruiter reports `100 roles/recruiter`,
`status: measured`, basis *"100 open roles carried by 1 recruiter"* — a per-team capacity figure
that is byte-identical for every tenant, under a pack whose own disclaimer says *"Figures
describe this workspace's own recorded activity."* `countOpenRoles(ws)` (`db/jobs.ts`) returns
`{ own, corpus, visible }` precisely so the call site can choose; the choice (almost certainly
`own`) and a `basis` string that **names the tier** are both still to be made, in
`app/api/analytics/metric-pack/route.ts` + the `analytics.metricPack.basis.*` catalog keys.

**The variant pause heuristic judges each creative on its own clock.**
`variantPauseRecommendations` (`app/_lib/source-analytics.ts`) gates a group on the *group's*
earliest lead — how long the comparison has run — **and** each variant on **its own**
`firstLeadAt`, the field's documented meaning. On the group clock alone, a creative added to a
long-running group was flagged the moment it appeared (60/40/1 leads with the third variant two
hours old flagged that variant at a 1 % share) under copy that promises *"after 72 hours of
data"*. Same rule for the share it prints: whole percent, except that a variant which **did**
land leads is never reported as a flat `0` — one lead in 201 is 0.5 %, and `Math.round` printed
*"holds 0% of 201 leads"* about a real lead, and tied every sub-1 % variant together so
"worst performers first" ordered them arbitrarily. `VARIANT_RULE`'s values are untouched.

**One key vocabulary for a creative.** `variantGroupKey` / `variantRowKey`
(`app/_lib/source-analytics.ts`) are the single source for the (job × campaign × variant)
identity: `db/analytics.ts` aggregates its windowed rows by the row key and the pause rules
re-group them by the group key, so the two halves cannot key differently. Both are **NUL-joined**,
the same joiner `analytics-cache.ts` uses for its memo keys and for the same reason —
`source_campaign` and `source_variant` are recruiter-entered free text, and under the previous
printable `|` joiner a campaign `"spring|A"` × variant `"v1"` and a campaign `"spring"` × variant
`"A|v1"` produced the identical key, merging two creatives into one row and moving the
fair-share floor that decides who gets flagged.

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
  `familyFloors` map says so explicitly rather than rendering a blank region; a suggestion off a
  high-leakage arm carries its contamination caveat beside the Apply button.
- **The holdout arm's SIZE is an expectation, not a balance — by design.** Membership is a
  pure function of `(jobId, entryId)` (`app/_lib/screen-wave-holdout.ts`), which is what makes
  it stable across a preview/commit pair and immune to threshold-slider re-rolls. The cost of
  that determinism is that the arm is *sampled*, never *balanced*: the realised count is
  binomial around `rate × N`, so a small wave can spare noticeably more or fewer candidates
  than the rate suggests, and nothing corrects it afterwards. Correcting it would mean either
  re-rolling membership (breaking the approval-token re-derivation) or reassigning specific
  people to hit a quota (which is the steering the hash exists to prevent). The accrual
  horizon shown beside the `circular` verdict is the honest surface for it: the arm leads only
  once it actually clears `minOutcomes`, whenever that happens to be.
- **The floor is never shown without its switch.** The route ships
  `autoRejectEnabled` (`screening.autoRejectEnabled`) beside `currentThreshold`, and the
  shipped default is **false** — `screen-wave.ts` returns `autoRejectOff` and rejects
  nobody. With the wave off, `AnalyticsReliabilityDiagram` draws **no** coral floor marker
  (its screen-reader line says the floor is recorded but not enforced, `srThresholdOff`),
  the panel legend reads `thresholdLegendOff`, and `AnalyticsFamilyFloorChips` swaps the
  "every family is screened at the global N" sentence for `familyFloorsNoneOff` plus a
  `role="status"` notice (`floorNotEnforced`). Both branches are pinned by
  `analyticsCalibrationFloorGate.test.ts`.
- **A score band is `[lo, hi)` — except at the top of the scale, where it closes.**
  `recommendScreeningThreshold` builds its above-floor band as `[T, min(100, T + bandWidth))`,
  so any floor at 90+ produced a band that could not see a perfect 100. With a floor at 95,
  eight 97s that mostly failed read as a textbook *"raise the floor to 100"*, while five 100s
  that all advanced — which put the band's real rate at 6/13 = 46 %, above the `lowRate` gate,
  i.e. *nothing to advise* — were invisible to the arithmetic that a single click applies to the
  live auto-reject floor. One `inBand()` predicate now decides membership, closing at `100`, and
  `computeThresholdEffect` uses the **same** one, so a sealed `[95,100]` band is later measured
  with exactly the membership it was argued from. Interior bands are unchanged.
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
- **The history strip reads the policy REF, not the tail of the chain.**
  `GET /api/analytics/calibration/threshold-history` asks `listDecisionRecords` for
  `candidateRef = policy:screening:<ws>` (`…:<family>` under a family filter) — the deterministic
  ref `/apply-threshold` seals every change under. It used to read the workspace-wide form,
  whose `limit` defaults to the newest **200 records of any kind**, and the chain fills with one
  seal per candidate decision: after a couple of screening waves the threshold seals fell off the
  end, so the strip rendered empty and `effect` went `null` — a floor change still in force
  reading as "never happened" on the surface built to audit it. A workspace-wide read is kept
  beside it purely as a compatibility net for a record sealed under some other ref shape; the two
  merge and de-duplicate on `seq`, newest first, so `history[0]` is still the apply `effect`
  measures against.
- **"Since the last change" applies its evidence floor to BOTH sides.** `computeThresholdEffect`
  gates only the *after* side (`measurable = after != null && after.n >= minOutcomes`); the
  *before* side comes straight from `effectSide()`, which returns a side for a single pair, and
  `ThresholdEffectSide` says so in its own type ("always read ALONGSIDE n, never alone"). The
  `effectDelta` copy prints exactly one `n` — the after one — so one in-band candidate decided
  before the apply, who advanced, rendered as „100 % before → 50 % after the change (n=12
  since)": a policy-effect story about the live auto-reject floor whose first figure is one
  person. `thresholdEffectClaim()` (`calibrationVerdict.ts`, pinned by
  `calibrationVerdict.test.ts`) resolves the sentence as a value — `too-few` / `after-only` /
  `delta` — and demands the **same** `minOutcomes` of the before side. Not a new threshold: the
  module's own "measure it" floor, applied to the side that was missing it. Below it the strip
  states the after-side figure alone (`effectAfterOnly`), which it can defend.
- **An apply confirmation speaks only for the scope it moved.** `useJsonFetch` deliberately
  keeps the last-good payload across a URL change, so `AnalyticsThresholdSuggestion` stays
  mounted while `roleFamily` changes underneath it. A scope-blind `done` state therefore
  survived a family switch and re-rendered under the new scope's copy: apply the **global**
  floor 45 → 40, select "Software engineering", and the card printed `recAppliedFamily` —
  „Software engineering floor set to 40 (was 45)." — for a family carrying no override at all,
  while hiding that family's own **Apply** button behind a done state it never earned. The
  settled phase now carries the scope it happened in (`{ kind: "done" | "error"; scope }`,
  captured at the click), and reads as `idle` under any other scope. It is never reset in
  place, so an apply still in flight keeps the button disabled until its response lands.
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
  outcome the curve counts. The override chips are a real **toggle** (they carry `aria-pressed`):
  selecting one narrows the curve, the recommendation and the sealed history strip to that
  family, and re-clicking clears back to all roles — the header's family `Select` is the only
  other way out and it renders only when `families.length > 1`, so a one-family workspace that
  also carries an override could otherwise drill in and never get out
  (`analyticsCalibrationFamilyApplyGate.test.ts`).
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

`analyticsPayloadMirror.test.ts` guards the other end of the same seam. `AnalyticsTypes.Analytics`
is a HAND-WRITTEN mirror of `PipelineAnalytics` (the client cannot import the server type — that
module opens better-sqlite3), and nothing compared the two: `timeToHireSamples`, `costPerHireAsOf`
and `hiresClosedInWindow` were sent on every request and declared nowhere, so the Economics
surface carried its own OPTIONAL intersection of two of them (`sections/economicsTypes.ts`) with a
comment asking a later change to delete it. The three fields are in the mirror, the intersection is
gone, and the test now fails in both directions — a server field with no client declaration, and a
client declaration the route never sends (only `deltas`, which the route adds, is exempt).

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
| `GET /api/analytics/calibration` | Band calibration + reliability; `?source=pipeline\|analysis\|holdout`, `?outcome=advance\|hired` (echoed back; `analysis` always falls back to `advance`), `?family=`. Pipeline source also ships `currentThreshold` **and `autoRejectEnabled`** — the floor never travels without the switch |
| `POST /api/analytics/calibration/apply-threshold` | Commit a suggested threshold (`requireOperator()` + `pipeline:write`; `suggestedThreshold` REQUIRED and compared against the live recommendation) |
| `GET /api/analytics/calibration/band` · `/threshold-history` | Band detail (`?bin=`/`?source=`/`?roleFamily=` — **no `?outcome=`**, so the drilldown is advance-axis only); the sealed floor-over-time strip, read by the `policy:screening:<ws>[:<family>]` seal ref rather than the tail of the chain |
| `GET\|POST /api/analytics/spend` | Per-channel spend; written back by the board's inline input. POST: `requireOperator()` + `pipeline:write` |
| `GET\|POST /api/analytics/targets` | Conversion goals + reserved keys (`time_to_hire`, `recruiter_hourly_czk`, `manual_hours_per_hire`), validated from `RESERVED_TARGET_KEYS`. POST: `requireOperator()` + `pipeline:write`. **`0` clears, like null/empty** — both stores behind these two routes `DELETE` on a non-positive value and answer 200, and the editor normalizes `0 → null` before posting |
| `GET /api/analytics/metric-pack?format=md` | The buyer metrics as JSON or a one-page Markdown pack; `?days=` optional |
| `GET /api/decisions/records` | The whole sealed chain + verdict; `?candidate=<entryId>` scopes to one subject (`requireOperator()`) |
| `GET /api/benchmarks` | Cross-workspace company benchmark. **Takes no window parameter** |
| `GET /api/pipeline/outcomes` | Not an analytics route — it belongs to the board — but Quality reads it for the hire-rating accrual counter `{ rated, hires, minOutcomes }` (`requireOperator()`). Capture side: [`../pipeline/README.md`](../pipeline/README.md) |

**No stage name is spelled on this page.** Two English literals outlived the role layer that
closed the rest: the offer panel's "who is sitting on an offer" link filtered the board on
`"Offer"`, and `weeklyMomentum` *defaulted* its terminal stage to `"Hired"`. Both are answers
that look like fallbacks and are simply wrong on a renamed board — an empty board view, and a
hire series flat at zero forever. The payload now carries `offerStage` (`db/analytics.ts`,
`stageWithRole("offer", axis)`; `null` when the axis declares no offer role, and the panel then
renders the pending count as plain text rather than a link that cannot resolve), and
`weeklyMomentum`'s `terminalStage` is a REQUIRED argument — there is no correct default, so the
type asks for it. Pinned by `app/_lib/db/analytics-custom-axis.test.ts` (a board whose offer
column is "Package") and by the hire-series test in `app/_lib/analytics-momentum.test.ts`.

**The TTL core is not an analytics module.** `createTtlCache` lives in
`app/_lib/ttl-cache.ts` — dependency-free, TTL + entry bound and *no invalidation policy of its
own*. It used to be an export of `analytics-cache.ts`, and every consumer that reached for "the
TTL idiom" reached for the analytics module with it: `pipeline-score-cache.ts` was built on
`createAnalyticsCache`, whose key carries the per-workspace analytics write version, so saving a
conversion goal or a channel spend figure retired the canonical-score fit map too and the next
board poll paid a full `buildFreshestFits()` for a write about neither scores nor analyses.
`analytics-cache.ts` now *composes* the core (and re-exports it, so the analytics, calibration and
decision-records routes import their cache from the module whose keys they use); the score memo
and `db/profiles.ts` take the core directly and are coupled to nobody. Pinned by
`app/_lib/ttl-cache.test.ts` and by "an analytics settings write leaves the score memo intact"
in `app/_lib/pipeline-score-cache.test.ts`.

**The short-TTL memos are bounded, not just expiring.** `createTtlCache`
(`app/_lib/ttl-cache.ts`) checks expiry on read, so the TTL alone never reclaimed an entry
whose key was not requested again. Three routes key it on raw query params — `?candidate` on
`/api/decisions/records`, `?roleFamily` on both calibration routes — none of them a closed
vocabulary, and `maxDuration` is serverless-only here, so a self-hosted process retained one
payload per distinct value indefinitely. The store now caps at 256 entries, reclaiming
TTL-expired entries before evicting any live one. The "no filter" marker in every key builder is
a doubled NUL separator rather than a printable `*`: those fields arrive from the URL, and
`?candidate=*` used to key to the same entry as the unfiltered load — serving its empty result
as the full decision-records list for the rest of the TTL.

**The tab is on the type scale and on the recipes.** The nine `text-xs` classes across the
automation, calibration, compute-cost and economics panels are now `text-micro` — the 14px floor
the design system states, rather than a utility that renders below it. Thirteen files carried
hand-typed `PANEL` / `META_LABEL` / `NOTICE("amber")` literals in
`app/_components/ui/recipe-debt.json`; twenty-one of the twenty-two now compose the recipe and
those twelve ceiling entries are DROPPED, which locks the win (the next literal to arrive in one
of them is `undeclared`, and red). One row is kept on purpose:
`sections/DecisionRecordsTable.tsx` `noticeAmber=1` is a `rounded` micro badge on a record row,
and `NOTICE()` carries `rounded-lg dark:rounded-2xl` — the recipe is the wrong shape for it.

**The two export buttons report a code, not a status.** The dossier export
(`AnalyticsDecisionRecordsPanel`) and the whole-trail export (`sections/DecisionLogTable`) used to
`throw new Error(String(res.status))` — and the number never reached a reader, because the catch
downstream painted one flat sentence for every failure. `GET /api/analytics/decisions` answers
`TOO_MANY_REQUESTS` (429, wait and retry) and `DECISION_LOG_LOAD_FAILED` (500, the read fell
over) with codes, and those two were indistinguishable. Both paths now resolve the body's code
through `useErrorMessage()` and throw a `LocalizedFailure`
(`app/features/insights/analytics/analyticsFetchError.ts`), which the renderer unwraps with its
own localized fallback; a caught Error's raw `.message` is never painted. `GET
/api/decisions/records` still answers with `jsonError` (message, no code), so the dossier export
resolves to its fallback sentence until that route is coded — the client is ready for it.

**One answer to "we have no data" per page.** The Economics board's three taxonomies
(`byChannel`, `bySource`, `byVariant`) are normalized onto one row model by
`app/features/insights/analytics/sections/economicsRows.ts`, and `hireRate(hired, total)`
returns `null` — not `0` — over an empty population, matching the dash `AnalyticsByRoleTable`
prints for the same case. The board previously computed a variant's rate inline as
`r.total ? … : 0`, so a creative nobody had ever applied through rendered as a "0 % hire rate"
verdict, while the sorter beside it already treated the same row as absent. The rate is now a
value whose empty case is a value; `economicsRows.test.ts` pins all three groups.

**The window queries seek, they do not scan.** `pipeline_entries` and `pipeline_events` carry
`idx_pipeline_entries_ws_created` / `idx_pipeline_events_ws_created` — `(workspace_id,
created_at)`, workspace first because it is the equality predicate. Every windowed query in
`pipelineAnalytics` is `created_at >= ? AND <notSim> AND workspace_id = ?`, and SQLite uses at
most one index per table: with only the workspace-only and `created_at DESC` indexes the planner
seeked by tenant and then date-filtered every row that tenant had ever written (it actually
reached for `idx_pipeline_dev_case`). `app/_lib/db/analytics-window-index.test.ts` asserts the
plan itself with EXPLAIN QUERY PLAN — an existence check on the index would only prove a CREATE
ran, and a timing test on a throwaway DB proves nothing.

**A write door retires its workspace's memo.** The TTL reasoning ("a write lands on the next
read past the TTL") holds for a pipeline write nobody is watching; it does not hold for
`POST /api/analytics/targets` and `POST /api/analytics/spend`, which are inline editors that
`reload()` the payload the instant they succeed — inside the TTL. Both now call
`invalidateAnalyticsWorkspace(ws)` (`app/_lib/analytics-cache.ts`) after the store write. It
bumps a per-workspace WRITE VERSION that rides in the memo key rather than calling `clear()`, so
every window of the written workspace is retired at once and no sibling tenant's fresh payload is
collateral. Pinned end-to-end by `app/api/analytics/analytics-write-invalidates-read.test.ts`,
which drives the real handlers: write, then read, and the read must carry the new figure.

Pure computation lives beside the route, not in it: `analytics-forecast.ts`,
`analytics-momentum.ts`, `analytics-deltas.ts`, `analytics-bottleneck.ts`, `analytics-offer.ts`,
`analytics-cache.ts` (over the generic `ttl-cache.ts`), `automation-roi.ts`, `metric-pack.ts`, `calibration.ts`,
`decision-attribution.ts` — each with a colocated `.test.ts`. On the client,
`calibrationVerdict.ts` and `analyticsFunnelEmptyState.ts` hold the two render decisions that had
to become executable values. Tables compose `app/_components/table/` (`TablePager`,
`ColumnFilter`, `ColumnHead` + `useTableSort`, nulls last in both directions).

**Filter menus are comboboxes (2026-09-04).** `ColumnFilter mode="select"` and
`SearchSelect` triggers carry `role="combobox"` + `aria-haspopup="listbox"` +
`aria-controls`, and the shared `OptionList` is a `role="listbox"` of
`role="option"` rows with `aria-selected`; the filter box drives them with
Arrow/Home/End/Enter and announces the current row through `aria-activedescendant`.
Before this the whole family had no `role=` at all — a div of buttons to a screen
reader, and unreachable by keyboard past Tab — while the neighbouring `Select`
primitive had been a full APG listbox for months. `mode="search"` deliberately
stays a plain button: it opens a free-text box, not a list. Pinned by
`app/_components/table/filter-a11y.test.ts`.

## Data model

Read-only over the operational tables, plus three the tab writes:

| Table | Role |
| --- | --- |
| `pipeline_entries`, `pipeline_events` | Funnel, dwell, momentum, decision log. `pipeline_events.actor` is nullable and never backfilled |
| `decision_records` | The per-tenant hash chain: `seq`, `prev_hash`, `content_hash`, `kind`, `actor`, `policy_version`, `candidate_ref`, `rationale`, `reason_code`, `payload_json`, `created_at`, `key_id` |
| `analytics_targets` | Recruiter-set goals: per-stage conversion %, plus reserved `time_to_hire`, `recruiter_hourly_czk`, `manual_hours_per_hire` |
| `channel_spend` | Per-channel spend with `updated_at`, read via `listChannelSpendDetail()` in `app/_lib/db/channels.ts` (`listChannelSpend()` survives for amount-only callers) |
| `llm_usage` | The compute-cost ledger (account-wide — see Known gaps) |

### Every aggregation read is bounded, and says when the bound bit

`pipelineAnalytics`, `pipelineAnalyticsPrior` (`app/_lib/db/analytics.ts`) and
`teamHiringStats` / `orgHiringBenchmark` (`app/_lib/db/org-benchmarks.ts`) aggregate in JS
over rows they SELECT, and until this round none of those reads had a ceiling — an all-time
view was a full scan of the board, run twice per load (current + prior window), and the org
benchmark scanned every sibling team's board as well.

Each read now takes `ANALYTICS_COHORT_CAP` / `BENCHMARK_ROW_CAP` (both **20 000** rows,
`ORDER BY created_at DESC`, read one past the cap the way `listJobsPage` does) and answers
**`truncated: boolean`** on the payload — `PipelineAnalytics`, `PriorWindowSlice`,
`HiringStats` and `OrgHiringBenchmark` all carry it, so `GET /api/analytics` and
`GET /api/benchmarks` carry it too. The bound is deliberately generous (20 000 candidates in
one cohort is beyond any deployment this product is sized for), so in practice it buys a
worst-case guarantee rather than changing an answer. `truncated` is the half that matters
when it does bite: a funnel computed over a silent slice reads exactly like the funnel over
the whole cohort and is a different number. The `rowCap` option on each function is for
tests only. Pinned by `analytics-cohort-cap.test.ts` and `org-benchmarks-cap.test.ts`;
`analytics-prior-slice.test.ts` additionally pins that the two cohort reads cut identically,
so a delta can never compare a whole window against a slice of another.

### The page counts in UTC, and now says so

Every date bound in `db/analytics.ts` is ISO-string comparison against `Date`
millisecond arithmetic, and the weekly momentum buckets are cut the same way — so
"the last 30 days" and every trend bar end at a **UTC midnight**, one or two hours
before a Central European operator's own day does. That is enough to move an entry
created late in the evening into the neighbouring bucket: small, real, and
invisible while nothing on the wire named the zone. `PipelineAnalytics.bucketTz`
declares it (`"UTC"`, from the module's single `BUCKET_TZ` constant so the claim and
the arithmetic cannot drift), and `AnalyticsHeader` states it under the window
switcher (`analytics.bucketTzNote`, 4 locales). The LLM ledger's daily cost rollup
cuts the same way and declares `tz` per bucket (`LLM_USAGE_DAY_TZ`, see the
provider-layer doc). Re-cutting the arithmetic in an operator's zone is a separate,
larger decision — it needs an operator zone to exist first.

Also single-sourced this round: `originOf`, the earliest-event → origin bucket map
`bySource` reports, was typed out byte-identically inside `pipelineAnalytics` and
`pipelineAnalyticsPrior`, whose entire contract is that they bucket the same rows
the same way. One module-level function now.

Payload additions this round: `truncated` (above), `bucketTz`, `ChannelEconomics.spendUpdatedAt`, `costPerHireAsOf`,
`hiresClosedInWindow`, `computeCost.windowDays` / `.hires`, and the `leakage` descriptor on both
calibration payload types.

## Honesty rules this surface keeps

Load-bearing, not stylistic: an unknown cost renders as `—`, never `$0` ("free" and "unpriced"
are different facts) · no verdict colour without a goal the org set · a ratio over 100 % is shown,
not capped · the forecast **names its method and its floor**: `MIN_FORECAST_HIRES = 3` completed
hires AND `MIN_FORECAST_INFLOW_WEEKS = 4` weeks that actually received candidates before it will
project at all (both inputs are gated because both are multiplied — one hire in one burst week
used to license a twelve-week projection to one decimal place, beside siblings gating at 3, 5 and
20), the refusal states how far this workspace is from each (`forecast.signal`, rendered as
`forecast.floorNote`), every horizon is labelled an *estimate* and carries the band at velocity ∓
one standard deviation of the weekly buckets (floored at zero), and `forecast.method` prints the
arithmetic — velocity × conversion, projected forward — under the figures · the forecast refuses
to project below that floor (`forecastHires().hasSignal`)
and **names the acceptance basis it substituted**: when an observed offer-accept rate applies,
`forecastHires` rebuilds the offer→hire leg as `(offerReached / firstReached) × acceptRate`, so
the horizons are NOT `overallConversionPct` — the figure the band's context sentence names — and
the brief prints `forecast.acceptBasis` ("assuming the observed NN % acceptance, n=…") beside
them. **That substitution requires a funnel of at least three rows.** The offer stage is
`funnel[length - 2]`, which on a two-column board *is* the entry row: `offerReached` equals
`firstReached`, the rebuilt conversion collapses to the accept rate itself, and the projection
reads as if every arrival reached an offer (a measured 60 % accept and 10 leads/week projected
72 hires at 12 weeks where the real 10 % conversion gives 12). Entry + terminal is a legal saved
axis — `validatePipelineStages` requires that much and no more — so such a board falls back to
the funnel-derived conversion and echoes `offerAcceptRate: null` · an unknown floor in the threshold-history strip renders `—`, never `0` — `0` is a legal floor (accept everything), so the fix is `floorLabel()` in `thresholdHistoryRows.ts`, not a falsy test; the strip's plot already skipped nulls while the sentence and the sr-only list beside it printed a prior floor no seal ever recorded · a rate with no cohort behind it renders `—`, never a confident `0 %` ·
capped tables say what they dropped and where to reach it · the first-run empty state previews
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

## Product analytics (Plausible) never sees a capability token

Separate from everything above — that is the operator's own board, computed from the local
DB. `app/_lib/analytics/` is the third-party half: `plausible.tsx` renders the script tag and
`track.ts` fires custom events (`workspace_entered`, `demo_started`, `checkout_started`).

Both are env-gated on `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`. Unset — dev, and every self-hosted
deploy that does not opt in — renders nothing and ships zero analytics bytes.

The rule when it IS set: **Plausible attaches `u: location.href` to every event it sends,
pageviews included**, and `<PlausibleScript />` is mounted in the ROOT layout, so it renders
on the public candidate surfaces too. Those URLs are not addresses, they are credentials —
whoever holds `/schedule/<token>` can act as that candidate, and `/apply/<jobId>` carries
`?lead=<token>` in the query. So:

- `TOKENIZED_PATH_PREFIXES` (`track.ts`) is the single list of those prefixes.
- The script tag ships them as `data-exclude` and loads `script.exclusions.js` — the build
  that reads that attribute. A matching page sends **no pageview at all**; plain `script.js`
  would ignore the attribute silently, so the two move together.
- `track()` refuses to fire from a matching path whatever the caller asks for.

`track.test.ts` pins the list against the `app/*/[token]` route directories and fails if
either half is dropped. Adding a candidate surface means adding its prefix there.

## Known gaps

- **The metric pack's `time_to_hire` sample counts a bigger population than the median was
  measured over.** `metric-pack.ts` samples that metric with `input.hired`, but
  `medianTimeToHireDays` / `avgTimeToHireDays` are computed in `db/analytics.ts` over the
  narrower `tth` set — terminal rows that ALSO carry `created_at`, `stage_changed_at` and a
  non-negative duration. On the shipped database 9 entries stand on `Hired` and 4 of them have
  no `stage_changed_at`, so the median rests on **5** observations while the pack prints
  *"Median days from first contact to hire, over 9 hires"*, `sample: 9`, `status: measured` —
  9 clears `MIN_SAMPLE = 8`, 5 does not, so a `certifiable` pack is published off a sample the
  pack's own contract calls thin. `status: measured` has to mean measured.
  **CLOSED 2026-08-29.** `pipelineAnalytics` returns `timeToHireSamples` (`tth.length`), pinned
  by `analytics-median-tth.test.ts`; `MetricPackInput` now carries that field and
  `buildMetricPack` samples `time_to_hire` — and writes its `basis` — from it rather than from
  `hired`. On the shipped corpus the metric reports `sample: 5`, `status: "thin"`, the basis
  says *"over 5 hires"*, and `certifiable` is **false**, which is the honest answer: `status:
  measured` means measured. The field is optional and falls back to `hired`, so any other
  caller is unchanged; both halves are pinned in `metric-pack.test.ts`.
- **`recruiter_capacity` is a point-in-time snapshot published under a windowed header.**
  `?days=90` prints *"Window: last 90 days"* over every row, but capacity's two terms
  (open roles, membership roster) are current counts with no window applied — the only row in
  the pack that is not a figure about the stated period, and its `basis` names no period either.
  (`cost_per_hire` is windowed-aware in the honest direction: spend is lifetime, so the route
  returns `null` and the pack says `not_measurable` rather than dividing a lifetime numerator by
  a windowed denominator.)
- **The metric-pack route's capacity comment argues the wrong way round.**
  `app/api/analytics/metric-pack/route.ts`: *"inflating the denominator would understate
  capacity, which is the direction that flatters us."* A capacity metric is roles **per**
  recruiter, so a larger denominator gives a **lower** ratio — the *un*flattering direction —
  and the narrow `CARRYING_ROLES` set is therefore the flattering choice, not the cautious one
  the comment claims. The same sentence also mis-names the set: it says *"Owners and admins"*
  while the code is `new Set(["owner", "recruiter"])`, which excludes `admin` and includes
  `recruiter` (`MEMBER_ROLES` in `app/_lib/auth/roles.ts`). The numbers are unaffected; the
  stated reasoning is not.
- **Quality presents the auto-reject floor as *in force* — the payload now says otherwise, the
  panels still do not read it.** `/api/analytics/calibration` ships `currentThreshold =
  effectiveFloor(screening, family)`, a plain number falling back to
  `SCREENING_DEFAULT.maxMatchToReject = 45`, while `autoRejectEnabled: false` is the shipped
  default and the wave returns `autoRejectOff` (`screen-wave.ts`). **The route half is closed**:
  the payload now carries `autoRejectEnabled: boolean | null` beside `currentThreshold` (`null`
  on the non-pipeline sources, exactly like the threshold — those arms carry no screening rule),
  read from the same `getDecisionConfig<ScreeningRule>("screening", ws)` the floor comes from.
  **The render half is open**: a workspace that never opened Decision rules still sees a coral
  "Auto-reject floor (45)" marker + legend on the reliability diagram
  (`AnalyticsReliabilityDiagram`), "every family is screened at the global 45"
  (`AnalyticsFamilyFloorChips` → `familyFloorsNone`), and either an **Apply (set floor to N)**
  button or "your auto-reject floor of 45" (`AnalyticsThresholdSuggestion`) — all describing a
  gate that rejects nobody. Only the `recAbsentNoFloor` branch tells the truth, and it triggers
  on the *value* (`<= 0 || >= 100`), not on the rule being off. Closing it now means branching
  those three surfaces on the flag the payload already carries;
  `leakageScoreCausedNote` ("automatic screening rejects on the match score") over-discloses
  from the same gap, which at least fails safe.
- **`effectAfterOnly` over-states an empty before side.** With the evidence floor now applied
  symmetrically (above), a before side of 1–7 in-band decisions falls to
  `effectAfterOnly` — „…No earlier in-band decisions to compare against." — which asserts
  *zero* where there were a few too thin to compare. Strictly better than the „100 % before"
  it replaces, but it needs a fourth string ("too few earlier in-band decisions") in all four
  catalogs; `thresholdEffectClaim` already returns the branch that would carry it.
- **`/apply-threshold` is a read-modify-write with no transaction around it — the store-side
  primitive now exists, the route has not adopted it.** It reads the screening rule, spends two
  full-table calibration scans re-deriving the recommendation, then writes
  `{…screening, familyFloors: {…}}` through `setDecisionConfig`. Two applies for two different
  families that interleave inside that window both merge onto the same stale map, so the first
  family's freshly-applied floor is silently dropped — a lost update on the live auto-reject
  gate, sealed as applied. (`setDecisionConfig`'s familyFloors-preservation backstop does not
  cover it: that only fires when the written config omits the key, and a family apply always
  includes it.) **Half closed**: `updateDecisionConfig(phase, mutate, ws, scope)`
  (`app/_lib/decision-config-store.ts`) is the transactional read-modify-write — an IMMEDIATE
  transaction that RE-READS the tier, applies the caller's mutation to that fresh value and
  writes, the `actOnPipelineEntry` discipline. `decision-config-isolation.test.ts` pins the
  freshness property (better-sqlite3 is synchronous, so the interleaving itself is not
  reproducible in-process; what is pinned is that the mutation lands on a re-read, and that the
  stale-snapshot shape the route still uses loses the other family's floor). **Open**: the route
  must pass only the mutation —
  `updateDecisionConfig<ScreeningRule>("screening", (cur) => roleFamily ? { …cur, familyFloors: { …(cur.familyFloors ?? {}), [roleFamily]: rec.suggestedThreshold } } : { …cur, maxMatchToReject: rec.suggestedThreshold }, ws, "team")`
  in place of the `const next = …; setDecisionConfig(…)` pair. Re-reading later in the route
  narrows the window without closing it.
- **The metric pack's `recruiter_capacity` counts the shared reference corpus as the team's open
  reqs.** `openRoles` is `listCorpusJobs(ws).length`, whose tenant predicate is `workspace_id IS
  NULL OR workspace_id = ?` — the same dual-tier read every jobs surface uses, so the ~100
  seeded `workspace_id NULL` corpus rows count for **every** workspace. A tenant with no
  authored openings and one recruiter still reports "100 open roles across 1 recruiter",
  `measured` (sample 100 ≥ `MIN_OPEN_ROLES = 3`), and every tenant in the account reports the
  same numerator. Whether a shared corpus row is a requisition a team is *carrying* is a product
  definition, not a bug in the route — closing it needs an owned-only count in `db/jobs.ts`
  (`JobRecord` carries no `workspaceId`, so the route cannot tell the two apart today).
- **`de` group separators parsed as decimals in the inline number editor. CLOSED 2026-08-29.**
  `AnalyticsInlineNumberSave` normalized whitespace but left `,` and `.` alone, so `Number()`
  read a German operator's `12.000` as **12** and stored it — a silent wrong write on a money
  path, while the `en` `12,000` failed visibly. `parseLocaleNumber(raw, locale)`
  (`app/features/insights/analytics/parseLocaleNumber.ts`) now reads the separators from
  `Intl.NumberFormat().formatToParts()` for the reader's locale, so `1.234` is 1.234 in `en`
  and 1234 in `de` and neither is right by accident. **The stated blocker — "no component-test
  layer to pin it" — was dissolved by extracting the parse rather than by accepting more
  risk:** it is a pure, import-free module, and `parseLocaleNumber.test.ts` exercises every
  locale × separator combination, the ambiguous `1.234`/`1,234` pair, both non-breaking group
  spaces, and the refusal cases directly. Group separators are removed, not validated for
  position (the digit sequence carries the value); a second DECIMAL separator still refuses.
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
