# Job & JD Management

Job descriptions move from an AI draft to a live, matchable role. This covers
the JD builder/lifecycle, structured job ingestion, the campaign-pack
generator, and the specificity linter that runs live in the builder.

**Naming.** The user word for a `jobs` row is **Job**; for the `jds` document it is
**Job description**; **Role brief** belongs to the intake dialog and nowhere else.
"Posting" is retired from copy — it named the `jobs` row on some surfaces ("Open the
posting", the job modal's first tab) and a `dev_postings` apply link on others, which
is two entities under one word. The `jobs.status` chip resolves its tone through the
shared five-state table in `app/_lib/status-tone.ts` like every other status on the
path; full mapping in [../README.md](../README.md) § "One vocabulary along the thread".
"Role" is still used as a synonym for Job in `jobs.posting.*` and the pricing copy —
a known, deliberately-deferred gap, because untangling it also touches `roleFamily`,
the role-intake dialog and the metered `job_posts` allowance.

## The corpus table runs on the shared table kit

`JobsTable.tsx` + `JobsTabResults.tsx` were the one long table in the studio that
used none of `app/_components/table/`: seven inert `<Th>` labels over a
`max-h-[70vh]` scroll pane that mounted **all 105 rows** of the demo corpus at
once, no ordering anywhere, and the filters in a toolbar far above the columns
they filtered. It now carries the same register as ProfileRoster and the Channels
ledger:

- **Sorting** — the shared `useTableSort` over accessors in `jobsTableView.ts`
  (pinned by `jobsTableView.test.ts`). Two rules live there because a hand-rolled
  accessor gets them wrong: a salary BAND sorts by its floor, and a missing value
  (no location, no band, not entry-eligible) resolves to `null` so it sorts last
  in BOTH directions instead of leading an ascending sort. "Not eligible" and
  "eligible, scored 0%" stay different facts.
- **Header cells** — the shared `ColumnHead`, which owns `aria-sort`; the local
  `Th` never claimed it, so a screen-reader user could not learn the table was
  ordered.
- **Filtering** — `ColumnFilter` triggers IN the headers (search on Role, selects
  on Mode / Seniority / Family, a one-option "eligible only" menu on Entry). The
  toolbar is gone; the filters still write the same `useJobsList` state, so a
  change re-queries `/api/jobs` after its debounce — filtering stays SERVER-side.
  The one control with no column to live in — "open roles only", a lifecycle
  predicate over the whole query rather than a value in any cell — is a toggle
  chip beside the count it changes.
- **Paging** — the shared 20-row `TablePager`. `useJobsList` owns the page index
  beside the filters and every filter setter returns to page 1; `clampPage`
  catches everything else (a publish that drops a row out of an "open only" view).

## Entry points

- `?tab=jobs` — the Jobs tab (drafts vs. published/closed, publish action). Its
  header carries **Import position** top-right (`IngestAdButton`), which opens
  the paste form directly under the header. The state is one
  `useIngestAdPanelLogic()` held by `JobsTab`, handed to the trigger and the form
  separately, so the two can never disagree about whether the panel is open; the
  trigger locks while a parse is in flight, because a run costs billed LLM time
  and its one deliberate exit is the form's **Cancel run**. Copy calls what is
  pasted a **job position**, not an ad — the corpus is roles, and the ad is only
  the format one arrived in.
- `?tab=library` — the saved-JD ledger (`JdsTab.tsx` → `JdsSavedLedger.tsx`); the whole page is the table now.
- `?tab=intake` — **Job intake**, the authoring tab (`JdsIntakeTab.tsx`): the intake dialog (default) and the AI JD builder (`JdsBuilder.tsx`, exported as `JdBuilder` via `JdsGeneratePanel.tsx`) behind one switcher. Authoring and the ledger were one page behind a Saved/Generate/Intake strip until the split; "which roles do I have" and "write me a new one" are two questions, and the ledger now opens on the answer to the first. Entry-mode rule: `jdsIntakeTabEntry.ts` (see `docs/features/intake/README.md`).
- `/jds/[slug]` — the public JD page (candidate-facing).

## Lifecycle stages

| Stage | What it means | Where it happens | Internal marker |
| --- | --- | --- | --- |
| **Generated** | AI has drafted a JD (RoleSpec + market salary + markdown) but nothing is saved. | `JdBuilder` → `JdBuilderResult` (in-memory). | — |
| **Draft** | The JD is saved and reusable for analysis/matching, but no candidates are sourced and it is not live. | `POST /api/jds/save` (AI builder) or `POST /api/jds` (manual paste). | `jobs.status = 'draft'` |
| **Live (sourced)** | The JD is live and matching candidates have been sourced into the Pipeline (they land at `Accepted`). | "Publish" button (`POST /api/jobs/[id]/publish`) — in the drafts panel and the posting modal. | `jobs.status = 'published'` |
| **Closed** | The role is retired: its apply link stops accepting applications, it drops out of the open catalog and the matching pool, and its in-flight pipeline entries in the caller's workspace are withdrawn. | `POST /api/jobs/[id]/close` (idempotent mirror of `/publish`). | `jobs.status = 'closed'` |
| **Published to job boards** | *(Not yet shipped.)* Distribute the JD to external job boards. | Disabled "Publish to job boards" button on `/jds/[slug]`. | — |

`setJobStatus` (`app/_lib/job-ingest.ts`) owns every transition; a seeded
corpus job with a `NULL` status is treated as already live. `Closed` was
added after the original two-state (draft/published) model to stop a filled
role from staying open forever — see `app/api/jobs/[id]/close/route.ts`.

## The salary band is AI-fixed, not editable

When a JD is **Generated**, the market-salary analysis produces a band with
its own provenance (`web-grounded` vs `estimated`), a confidence level, and
cited sources. That band is the single source of truth the Pipeline matches
against: `ingestStructuredJob` (`app/api/jds/save/ingest-job.ts`) sets
`job.salaryBand` from the analysis's `salary`, normalizing a
backwards/degenerate range rather than dropping it. The band is intentionally
**read-only** in the builder — a hand-typed number couldn't honestly wear the
"web-grounded · high confidence · [sources]" label. The **Edit** tab edits the
JD **markdown** wording only; editing the salary line there changes the
published wording, not the matchable band, and the salary card says so
explicitly.

That contract has to survive the edit-time re-sync, and it did not:
`PATCH /api/jds/[slug]` keeps the linked `jd-<slug>` Job in step with an edited
body by re-parsing the markdown (`ingestJobAd`) and upserting the result, and
`insertJob`'s upsert writes `salary_min`/`salary_max` from the parse — so the
grounded band was replaced by whatever the wording now said (the hand-typed
override, exactly), or by the taxonomy anchor `normalize_job` stamps as the
`salary_band` phantom when the edited text states no pay at all. Both ingests
now pin the band through one helper, `withGroundedBand` (`app/_lib/salary-band.ts`):
the first ingest passes the analysis's salary, the re-sync passes
`groundedJdBand(jds.analysis_json)`, and a JD with no usable analysis band (a
pasted JD, a keyless 0–0 miss) keeps the parsed figure, because for those the
wording is the only source there is.

### The card says which benchmark, how old, and how thin

A `deterministic` band is read off `data/salary_benchmarks.json`, and the card
used to show only *that* it was estimated — not that the table is a **2025**
vintage, and not that `product_project` and `hr_people` are hand-entered with no
sample behind them while `operations_logistics` rests on 838 ISPV rows. The CLI
now returns `result.benchmark` (`{sourceId, asOf, sampleK}` — see
`docs/features/matching/README.md`), `normalizeMarketSalary` carries it onto
`MarketSalary.benchmark`, and `SalaryCard`
(`app/features/library/jds/JdsLedgerDetailPanels.tsx`) renders:

- the dataset and its vintage — *"Benchmark cz-ispv-2025, updated Jul 2026"* —
  in the reader's language and month precision, because the table is a periodic
  snapshot and a day-precise date would imply a freshness it does not have;
- a thin-data caveat when `sampleK` is below `THIN_SAMPLE_K` (30) or absent —
  `(n=19)` for a thinly-measured family, *"no sample recorded (editorial
  anchor)"* for a hand-entered one. `null` sample means **no sample**, never
  zero rows, and nothing does arithmetic on it.

A **grounded** band carries `benchmark: null` and shows none of this: its
provenance is the cited sources beside it, and stamping the internal table's
vintage on a live-web read would name a dataset the figure never came from.
The shared helper is `app/_lib/salary-benchmark.ts`; its test pins
`THIN_SAMPLE_K` and `ACTIVE_BENCHMARK` against the Python constants they mirror,
so a regenerated benchmark block fails the suite instead of silently ageing the
label. The report's salary tab shows the same vintage as an *anchor* line, but
only when `metadata.deterministicEvidence.anchorBand` actually holds two numbers
— with no anchor, the estimate rested on the model alone and naming a dataset
would be a false attribution.

The card's confidence is also a `ConfidenceBadge` now, graded through the same
`confidenceGrade` helper the report's gauge uses. It used to print the engine's
raw English word (`medium`) beside otherwise fully localized copy, and it was
the one surface in the app where this quantity was not a badge.

## Templates are a live reformat — a switch warns before discarding edits

The **Template** selector in `JdBuilder` is both a pre-generation choice and a
post-generation live reformat: picking a different template re-renders the
AI's structured output through the new company format
(`JdBuilderResult` is mounted with `key={templateId}`, so switching remounts
it). Contract:

- **Untouched body → switch reformats immediately.**
- **Hand-edited body → switch is confirmed first.** `JdBuilderResult` reports
  whether its body was edited (`onEditedChange` → `resultDirty`); a switch is
  staged (`pendingTemplateId`) and an inline "Replace edits / Keep editing"
  prompt gates it.

Edits live only in memory until **Save as draft** persists them; switching
templates is the one action that can replace them, and it now always asks.

### A template list that could not load says so

`fetchTemplates` (`app/features/shared/templatesClient.ts`) answers
`{ templates, failed }` — it used to swallow every failure into `[]`, which made
"this workspace has no templates yet" and "the template service is down" the
same value to both of its readers:

- **`JdBuilder`** then offered only *AI default format*, which reads as a
  deliberate choice. It now shows an amber `role="status"` line beside the
  selector. The build still runs (the AI default is a real format), so this is a
  caveat, not the form's `role="alert"` submit error.
- **`BuildIntentLine`** (the ledger's build-provenance row) printed the same
  "—" it uses for a template *deleted since the build*, so an unreachable
  service read on screen as a deletion. The dash now means only the deletion;
  the unreachable list gets its own line.

Both resolve the message from the machine code (`TEMPLATE_LIST_FAILED`) through
`useErrorMessage()`, never from the server's English. The load goes through
`sharedGetJson`, so a builder and a provenance modal opening together make one
request. `app/features/shared/templatesClient.test.ts` pins the distinction — an
empty list is a success, a 500 and a transport failure are not.

## Save vs. ingest — a draft can exist without a matchable Job

`POST /api/jds/save` does two things, and only the first is authoritative:

1. **Save the JD draft** (`saveJd`) — the markdown/title row in `jds`. If this
   fails, the whole request errors and nothing is saved.
2. **Ingest the role as a structured `jd-<slug>` Job**
   (`ingestStructuredJob`, `app/api/jds/save/ingest-job.ts`) — best-effort,
   wrapped in try/catch, never blocks the JD save. The response field
   `jobIngested` reports whether it ran. The client-sent `role` payload is
   parsed at the boundary via `parseRoleSpec` (`app/_lib/rolespec.ts`) — the
   canonical TS `RoleSpec` is now inferred from the **generated** Zod schema
   (`roleSpecSchema` in `app/_lib/schemas.generated.ts`, source of truth
   `pipeline/jobfit/devcase/models.py`, regenerated by `schemas:gen`); a
   malformed role degrades to `{}` instead of a blind cast. The same generated
   file also exports `roleBriefSchema` — the RoleBrief (graded requirements +
   open-vocabulary facets with provenance, `pipeline/jobfit/rolebrief.py`),
   the schema foundation of the role-intake concept
   (`docs/concepts/role-intake-dialog.md`).

"Publish" (`POST /api/jobs/[id]/publish`) looks up the job by
`getJob('jd-<slug>')`. If ingest failed, that row was never created, so a
Publish click would 404. The builder reads `jobIngested`: `false` disables
Publish with an inline **Retry** that re-POSTs to
`/api/jds/save` with the existing `slug` to re-run only the ingest (no
duplicate draft). When `slug` is supplied, the save route rejects an unknown
slug (404) so a retry can never mint a `jd-<slug>` Job with no backing draft.

### Which team's JD `/jds/[slug]` serves

The page is candidate-facing and a candidate carries no session, so the visitor's
workspace cannot be the tenant authority. `app/jds/[slug]/page.tsx` resolves it in
two steps:

1. **The linked opening's team** — `getJobWorkspace(jdJobId(slug))`. This is the
   public authority: a share link resolves to the team that published the role, for
   anyone holding it.
2. **The viewer's own team**, only when step 1 returned no row. A JD does not always
   have an opening — the builder's "Save as draft" posts to `POST /api/jds`, which
   ingests nothing, and the generate path's ingest is best-effort (`jobIngested:
   false`) — and `getJobWorkspace` folds "unknown job id" into the DEFAULT workspace.
   Without this step, a JD authored by any **non-default** team and not (yet) linked
   to a job 404'd on its own detail page, for its own author.

The fallback cannot widen what is public: `loadJd` matches on the workspace it is
given, an anonymous visitor resolves to the DEFAULT workspace (i.e. the query that
just missed), and the only other workspace ever read is the caller's own session's.
`canManage` (the Edit/Archive/History controls) still requires
`isOperator() && currentWorkspace() === owner`, where `owner` is whichever of the
two produced the row.

### Publishing a draft reports its outcome in a toast

A publish spends ~20s in the sourcing matcher, and its outcome used to be an
inline note under the drafts list — which the success path then deleted:
publishing the last draft empties `drafts`, `DraftsPanel` early-returns `null`,
and the note went with the panel. The recruiter saw a label revert and nothing
else. Outcomes now go to the shared toast queue
(`app/_components/toast-store.ts`), which outlives the surface that raised them:
one success toast naming the role plus the sourced count, and — when
`sourcingWarning` is set — a second, separate error toast, so "the role is live"
and "sourcing broke" are never merged into one ambiguous line. The 402 quota
refusal is the one outcome that stays inline, because it carries a Billing CTA
and the panel is still standing in that branch. The in-flight button carries a
spinner for the same reason: a static label swap on a disabled button was
indistinguishable from a click that did nothing.

Both publish paths (`JobsDraftsPanel`, `jobsPostingModalLogic`) also call
`notifyDataChanged()` (`app/features/shell/live-refresh.ts`) on success. Neither
did before, and the bus is signal-on-call, not fetch-interception: a publish
flips a status AND files people into the pipeline, so the sidebar's Jobs badge
and any open board kept their pre-publish numbers until the 60s attention poll
came round (`app/features/shell/useAttention.ts`) — in another window, not at
all.

## The two meanings of "Publish" — disambiguated

1. **Publish** *(internal go-live)* — marks a saved draft live
   and sources matching candidates into the Pipeline
   (`POST /api/jobs/[id]/publish`). Idempotent — re-running does not
   re-source. UI label: "Publish" (was "Source into Pipeline", which named the
   side effect rather than the act; the sourcing is reported in the outcome
   toast instead). One label on both surfaces that call the route —
   `JobsDraftsPanel.tsx` and `JobsPostingModalFooter.tsx`, which share the
   `jobs.drafts` message namespace.
2. **Publish to job boards** *(external distribution)* — not yet
   implemented; the button on `/jds/[slug]` is disabled ("coming soon").

> The API route (`/api/jobs/[id]/publish`) and the `jobs.status = 'published'`
> column are a stable internal contract (matching engine, the simulation
> harness's `data-sim-click="publish"` hook, `listJobStatuses`) and were
> deliberately left unchanged — only the user-facing labels were renamed.
> Read `published` as **"Live (sourced)"**, never as external job-board
> publishing.

### Publishing tells the whole story

`POST /api/jobs/[id]/publish` answers six facts —
`{ sourced, skipped, sourcingWarning, silverMedalists, alreadyPublished, reopened }`
— and both publish surfaces read two of them. The result was not merely thin, it
was wrong in the case that matters: an idempotent re-publish **skips sourcing
entirely** (`if (!already)`), so its `sourced: 0` was rendered as "Sourced 0
candidates into the Pipeline." — a fresh go-live that matched nobody, which is a
very different and much more alarming event. A reopen looked like a first
publish, and the rediscovery alerts a genuine go-live raises were never mentioned.

`jobsPublishResult.ts` now selects one sentence per fact (pinned by
`jobsPublishResult.test.ts`): the lead states the transition (went live / reopened
with the count restored / already live and nothing re-sourced), then the sourcing
count, the unreadable-profile count, and the rediscovery flags — each only when it
has something to say. A `sourcingWarning` is amber and **replaces** the sourced
claim, and its text (an Error message, sometimes a Python traceback) never reaches
the screen: it selects a localized sentence. `JobsPublishNote.tsx` renders the
list, so the Drafts panel and the modal footer tell the same story from the same
call.

**The wait is narrated and escapable.** Publishing runs a sourcing child plus the
rediscovery fan-out and can take minutes; the only signal was a disabled button.
There is now a live region under it naming the wait and a **Stop waiting** action
backed by an `AbortController`. The copy is careful about what leaving does: the
route threads the request's `AbortSignal` into the sourcing child, so aborting
genuinely stops the sweep, but the go-live transaction commits *before* sourcing
starts — so the sentence says the role is probably live and the sweep was
cancelled, rather than guessing either way. The route itself is unchanged.

This stayed a synchronous call rather than moving to a background task
(`TasksProvider`) deliberately: registering a new task kind means touching the
task registry and its handler, which is a different area from this one. Instead
the result gets a memory of its own — a module-scope map in `jobsPublishResult.ts`
keyed by job id — so closing the modal mid-publish no longer throws the answer
away. Reopening the role shows it labelled **Last publish**, never as a fresh
result, and it is deliberately not storage-backed: a week-old sentence restored
after a reload would be a worse lie than silence.

Finally, `JobLifecycleStrip` takes a `refreshToken` the modal bumps on every
transition. Its effect keyed on `[jobId]` alone, so the strip a recruiter had just
watched go live kept showing the pre-publish funnel, channels and decision counts
until the modal was closed and reopened.

### The go-live is one transaction, on one connection

`/publish` runs the billing gate (`jobPostGate`), the status flip
(`setJobStatus`) and the `job_posts` debit inside one `ensureDb().transaction`,
so a refused publish never charges and a live role never escapes the meter. That
was only nominally true until `app/_lib/job-ingest.ts` stopped opening its own
`openStore()` connection: with the flip committing on a second handle, the gate's
`billing_state` read had already opened the main handle's WAL snapshot, and the
debit that followed failed with `SQLITE_BUSY_SNAPSHOT` — the transaction rolled
back, the route answered 500, and the role was already live and unmetered.
`job-ingest.ts` now writes the `jobs` corpus through the main handle; `job_ingests`
(its dedup cache) is created and migrated in `app/_lib/db/core.ts` with the rest
of the boot DDL. `app/api/jobs/publish-atomicity.test.ts` drives the exact
sequence against the real modules.

### One opening, one charge — a reopen is free

The `job_posts` debit fires **once per job ever**, not once per publish. The route
reads the transition from `classifyPublish` (`app/_lib/job-ingest.ts`), which
answers three questions off one row: is it already `published` (idempotent
re-publish, nothing happens), was it `closed` (a reopen, so `reopenEntriesByJobId`
restores the withdrawn entries), and does it carry a `published_at` stamp — the
record that this role has been to market before. Only a role with **no** stamp is
billable, so `jobPostGate` and `recordMeterUsage` run on the first go-live and on
nothing else. Closing a filled role and reopening it a month later costs nothing
and is admitted even when the period's allowance is spent.

Until this was implemented the rule existed only as prose (here, in the route, and
in `jobPostGate`'s own doc comment), justified by the `published_at =
COALESCE(published_at, ?)` stamp inside `setJobStatus` — which guards the
timestamp and never reaches the meter. The skip tested `prevStatus === "published"`
alone, so every closed → published reopen took the gate and paid again.
`app/api/jobs/jobs-publish-billing.test.ts` pins all four cases (first publish,
idempotent re-publish, reopen, reopen on an exhausted meter).

### Failures answer with a code, never with the thrown message

Ten handlers here forwarded `error instanceof Error ? error.message` straight into the
response body — better-sqlite3 constraint text, the absolute database path, and on the
three spawning routes the Python traceback and CLI stderr `python-runner.ts` re-throws.
All ten now answer `safeJsonError(error, "api:jobs/<route>", "<CODE>")` against ten new
`STORE_ERRORS` entries (`JOB_LIST_FAILED`, `JOB_LOAD_FAILED`, `JOB_INGEST_FAILED`,
`JOB_PUBLISH_FAILED`, `JOB_CLOSE_FAILED`, `JOB_CANDIDATES_FAILED`,
`JOB_REDISCOVER_FAILED`, `JOB_WINNABILITY_FAILED`, `JOB_CAMPAIGN_FAILED`,
`JOB_ASSIGNMENTS_FAILED`), each with its four catalogue entries, so the reader sees the
message in their own language via `useErrorMessage()`. The ten rows this area held in
`app/api/error-response-contract.test.ts`'s ceiling are deleted rather than lowered: a
new leak here now reads as `undeclared`. Refusals that carry real information keep their
own shape — `CampaignError` and `PipelineError` still forward their client-safe message
and status, and `AutomationError` does the same on outreach. Full rule:
`docs/architecture/api-contracts.md` §1.1.

`GET /api/jobs/status` answers `{ drafts }` and nothing else. It used to ship a second
field, `statuses` — the whole workspace's jobId → status map — which no client ever
read: `JobsDraftsPanel.tsx` is the only caller and takes `drafts`. `listJobStatuses`
remains for server-side callers.

### A failed READ answers with a code too

The rule above covers what the routes *send*. What the client *renders* was the
other half, and the shared read hook broke it for every dashboard tab at once:
`useJsonFetch` did `setError((body && body.error) || errorLabel)` — the inverted
fallback chain `app/_lib/use-error-message.ts` exists to forbid — so the caller's
localized label almost never won and every locale got the server's English. The
hook now keeps the failure as `{ code, status }` (`jsonFetchFailure`, pure and
pinned by `app/_lib/useJsonFetch.test.ts`) and derives the rendered string through
`useErrorMessage`: the code resolves in the reader's language, `errorLabel` is the
fallback for a code the catalog does not know, and the prose is never shown.
`code` / `status` ride out alongside `error` for callers that must branch on the
outcome. Every consumer of the hook — here the Coach, Compare, Rediscover and
Agent-fit tabs — inherited the fix without a call-site change.

Two hand-rolled reads in this area followed:

- **The Campaign tab keeps the code.** `jobsCampaignTabLogic` threw `d.error` into
  a `catch` that ignored it, so a 429 back-off and a 500 store fault both read
  "Couldn't load the pack." The failed response's `code` is now carried to the
  catch and resolved, with `loadFailed` as the fallback. Warning codes the build
  has no sentence for are no longer filtered out in silence either — an unknown
  code renders as `jobs.campaign.warnUnknown` naming the code.
- **The Drafts panel fails visibly.** `loadDrafts` ended in `.catch(() => undefined)`,
  leaving `drafts` at `[]` — and the panel returns `null` when empty, so a failed
  read was indistinguishable from having no drafts: an authored JD awaiting
  sourcing simply was not there. A failure is now its own state; the panel stays
  on screen with `jobs.drafts.loadFailed` and a retry that re-runs the read.

### Every jobs route that spawns or spends is throttled

Eight routes here reach a child process or a model on an accepted request, and
until 2026-09-02 none carried a limiter — the whole area was missing from
`app/api/rate-limit-contract.test.ts`. Each is session-gated, and open mode
(`KP_OPERATOR_PASSWORD` unset) makes that gate a documented no-op for the entire
API, so the routes self-limit. All are per-IP over the shared 10-minute window and
refuse through `jsonRefusal("TOO_MANY_REQUESTS", 429)`, so the client renders the
throttle in the reader's language.

| Route | Key | Budget | What it buys |
| --- | --- | --- | --- |
| `POST /api/jobs/ingest` | `jobs-ingest:<ip>` | 20 | Claude CLI ad-parse |
| `POST /api/jobs/[id]/campaign` | `jobs-campaign:<ip>` | 20 | uncached creative pass |
| `GET /api/jobs/[id]/candidates` | `jobs-candidates:<ip>` | 30 | `recruiter_cli` ranking child |
| `GET /api/jobs/[id]/winnability` | `jobs-winnability:<ip>` | 30 | `winnability_cli` child |
| `GET /api/jobs/[id]/rediscover` | `jobs-rediscover:<ip>` | 30 | `recruiter_cli` ranking child |
| `POST /api/jobs/[id]/publish` | `jobs-publish:<ip>` | 20 | metered debit + sourcing child + alert fan-out |
| `POST /api/jobs/[id]/candidates/outreach` | `jobs-outreach:<ip>` | 60 | drafted first-touch + Outbox dispatch |
| `POST /api/jobs/[id]/agent-fit` | `jobs-agent-fit:<ip>` | 20 | backgrounded `agent_fit` LLM transform |

Every limiter sits **after** the cheap refusals (visibility/ownership 404s, the
validation 400s, the outreach GDPR 409, the empty-pool short-circuits) and
**before** the spawn, the spend and — on publish — the billing transaction, so a
request that was never going to do work consumes no budget. The contract test pins
the key, the budget, the call site and that ordering for all seven.

`/publish` also carries `maxDuration = 180`, matching every sibling that spawns
(`jobs/ingest`, `candidates/outreach`, `rediscovery/alerts`): a go-live runs two
spawning steps back to back and 60 was under the ad-parse provider timeout alone.
`maxDuration` is serverless-only — a self-hosted `next start` never kills a
handler, so the real bound is the per-child timeout in `python-runner.ts`; the
value only stops a platform that enforces it from 504-ing a valid go-live and
orphaning the children.

## JD specificity lint (Erika gap E7)

`app/_lib/jd-lint.ts` is a pure, LLM-free rules module that runs live on every
edit in the builder: EN+CS boilerplate phrases ("competitive salary", "dynamic
environment", with inflection-tolerant Czech stems), missing concretes (no pay
figure, no place of work — a work-mode keyword counts as place; a structured
market band suppresses the salary finding), exclusionary/gendered-coded
language, and an over-long must-have list. Findings render through one shared
panel, `app/features/library/jds/JdsLintPanel.tsx` (the `JdBuilderResult` this
section used to name is gone). Pinned by `jd-lint.test.ts`.

**Only one surface renders the all-clear.** `JdBuilder`, the ledger's in-modal
editor and the public page's `JdActions` all gate on `findings.length > 0`, so a
draft that has not been linted simply shows nothing. The Ledger detail read-view
(`JdsLedgerDetailModal`) is the exception — a clean *published* JD should say so
— which makes it the one place where "zero findings" is spoken aloud as a verdict.
It therefore has to respect the engine's own entry condition:
`builderLintFindings` returns `[]` for any body shorter than `LINT_MIN_BODY_CHARS`
(40) so a thin draft isn't nagged, and the read-view treats that `[]` as an
all-clear it never earned — a hand-saved JD reading "Senior React developer
needed." was told "pay, place, no boilerplate. Reads concrete." about text that
states neither. The panel now renders only once the body clears the threshold.

Every rule here uses `\p{L}` guards, never `\b`: JS word boundaries are defined by
ASCII `\w`, so a trailing `\b` after a diacritic-final stem can never match. That
is not theoretical — `/musí\b/` failed on *every* occurrence ("í" and " " are both
non-`\w`, so there is no boundary), which meant a Czech JD listing a dozen
`musí …` requirements counted **zero** must-have markers and linted clean while
the identical English JD flagged. The markers now read
`(?<!\p{L})…(?!\p{L})`; `PLACE_RE` drops the boundary entirely for the same reason.

The `manyMustHaves` finding is a **warning above 8, not a cap** — nothing clamps
the list, deliberately: a blind slice can drop a confirmed dealbreaker that
happens to be listed ninth (a language requirement, say), turning a knockout into
silence. It also only sees markers in the *prose*: a build whose `RoleSpec`
carries eleven `mustHaves` renders them as plain bullets under "What you'll bring"
(`composeMarkdown`, `jd-build-run.ts`), which contain no marker word, so the
builder's own output does not trip the rule.

### The salary-suppression seam is resolved per surface

`lintJd`'s `salaryAvailable` input means "a grounded figure exists outside the
prose, so don't nag about pay", and it is resolved differently before and after a
build. **Pre-build** (`JdBuilder`, over the recruiter's typed need) it is the
ticked *market research* checkbox — an intent whose result isn't knowable yet.
**Post-build** — the Ledger read-view and in-modal editor, and the public JD
page's editor — it comes from `jdMarketResearchAvailable`
(`app/features/library/jds/jdsLibrary.ts`), which asks only whether the stored
artifacts carry a **usable normalized band** (`normalizeMarketSalary(...).available`).

That function used to accept the ticked option as evidence too, and that was
wrong in exactly the case the lint exists for: `runMarketSalary` legitimately
resolves to `available: false` (the CLI's 0–0 taxonomy miss, or a keyless
deterministic run with no band), and `composeMarkdown` then **omits the salary
line entirely** while `marketSalaryLabel` renders `""` into a template's
`{{salary}}` slot — so the published body carried no pay figure anywhere and the
lint panel still showed its all-clear. In the Ledger the read-only `SalaryCard`
at least says "salary unavailable"; on the public page's editor there is nothing
to contradict the all-clear. Pinned by `jdsLintWiring.test.ts`.

## The posting is a document, so it picks its own language

The Posting tab renders `jobToMarkdown` — the copy-to-job-board artifact — and
carries its own language toggle, defaulting to the app locale. That toggle now
offers **all four** app locales: the heading/label table used to be a two-column
`en | cs` object literal in `jobsMarkdown.ts`, so a German or French recruiter was
silently pinned back to English. The scaffolding comes from `jobs.posting.doc.*`,
and the role family / seniority / work mode / education floor read the shared
`enums.*` labels, so a posting and the pipeline board never name the same slug
differently (the old private map covered 3 of the 16 role families and printed
the raw slug for the rest, with the work mode hardcoded English in every
language, and the education floor printing a bare `bachelor` beside a Czech
`Vzdělání:` label). A slug with no catalog entry (`high_school`) still degrades
to the slug itself, never to a `enums.*` key path.

`min_education` also carries the taxonomy's "no requirement" value, `"none"` —
which both scorers special-case (`job.min_education != "none"` in
`matching.ko_filter` and `winnability.loose_gates`, and it is also the fallback
`jobs.py` stamps on an off-taxonomy parse). The posting **omits the education
line entirely** for it rather than publishing a phantom `Education: none`
requirement that nothing enforces.

Strings for a language *other* than the app's are loaded lazily through the
locale-pinned translator (`app/_lib/catalog-translator.ts`) — the document-reader
mechanism described in
[`docs/architecture/localization.md`](../../architecture/localization.md). The
salary band's digit grouping and its unit travel with that table for the same
reason; `jobMarkdown.test.ts` pins both across every posting locale.

## Sourcing campaign packs (Erika gap E1)

From a published job, `pipeline/jobfit/campaign.py` (+ `campaign_cli.py`)
generates a localized campaign pack — 6–12 short ad-copy variants and 15-second
video **scripts** per channel (FB/IG/board) and per candidate language,
following a hook taxonomy (number / location / problem / skills — the
"employee POV" beat is deliberately excluded, since a testimonial can't be
honestly fabricated). LLM path via the same automation task + cache pattern as
`automation.py`, with a deterministic fallback assembled from structured job
fields (salary band, location, work mode, shift). `defaulted_fields`
(assumed values such as "Praha"/"medior") are never advertised in the copy;
missing facts surface as localized warning codes. One pack per job × language,
persisted in `campaign_packs`.

| Route | Method | Purpose |
|---|---|---|
| `GET /api/jobs/[id]/campaign` | GET | Return the stored pack. |
| `POST /api/jobs/[id]/campaign` | POST | Generate/regenerate (spends a fresh creative pass — no cache, since "Regenerate" must mean new copy). |

Every CTA in a pack links the quick-apply form; the pack ships a markdown
copy-all export. Rendering the video scripts into actual video/avatar assets
is out of scope (kp generates scripts only).

**One pack per (job, language) is a GLOBAL constraint, not a per-team one.**
`campaign_packs`' primary key is `(job_id, lang)`; `workspace_id` was added by a
later migration and is *not* part of it. `saveCampaignPack` upserts with
`ON CONFLICT(job_id, lang) DO UPDATE … WHERE campaign_packs.workspace_id =
excluded.workspace_id`, which correctly stops team B overwriting team A's pack —
but the same foreign row also blocks B's own INSERT, and SQLite reports that as
*zero changes, no error*. Reachable on any shared corpus job (`workspace_id`
NULL — the seeded reference roles every tenant can open the Campaign tab on).
The store therefore **throws** on a zero-change write rather than returning a
record for a pack that was never stored (`changes === 0` can only mean a foreign
row holds the slot: a fresh insert and a same-team regenerate both report 1).
Behavioral coverage: `app/_lib/db/campaign-tenancy.test.ts`. The real fix is a
`(job_id, lang, workspace_id)` key — a `campaign_packs` rebuild in `core.ts`,
listed under Known gaps.

**The read is validated; the write is not, on purpose.** `getCampaignPack` decoded
its JSON column with `safeRowParse<unknown>(…)` and no validator, while `intakes.ts`
beside it passes a schema for every column it reads — so the type assertion in
`JobsCampaignTab` was the only thing between the column and the screen, and a
truncated write, a hand-edited row or a pack from an older `campaign_cli` painted
`undefined` into ad copy a recruiter was about to publish. The read now parses
against `campaignPackSchema` (`app/_lib/schemas.ts`): a pack that does not clear the
floor the tab dereferences — `hookType` / `hook` / `adCopy` / a complete
`videoScript` per variant, warning **codes** as strings — reads as ABSENT ("no pack
yet, generate one") instead. The schema is a floor, not a filter: `z.looseObject`,
so unknown keys `campaign.py` adds (`defaulted_fields` is queued) survive the round
trip. `saveCampaignPack` stays unvalidated, deliberately — refusing at write time
would throw away the only copy of a paid LLM run, and a pack that cannot be read
back is a decode failure the read reports (and books in the decode ledger), not a
lost artifact. Pinned by `app/_lib/db/campaign-store.test.ts`.

Generation is a background task, so the tab hands `jobTitle` to `startTask` purely
to name the run — `tasks.kind.campaign` is `"Campaign pack · {job}"` and
`detail(p.jobTitle, p.jobId)` otherwise falls through to the raw `jd-<slug>` id in
the tasks dock. The runner itself never reads it (`campaign-run.ts` re-reads the
job from the DB). The stored pack's "generated at" stamp is formatted in the APP
locale, not the browser's, for the reason `groupEvalHelpers.ranWhen` documents.

The language toggle and the stored pack are read as a pair. The tab renders its
load error *beside* the pack rather than instead of it, and nothing in the pack
names its own language — so `useCampaignTabLogic`'s failed-load path drops any
record whose `(jobId, lang)` is not the pair that just failed. Without that, a
`cs → de` toggle into a 500 left the Czech ad copy on screen under a lit **DE**
toggle, ready to be copied onto a German job board. A reload of the *same* pair
(the refetch after a finished generation task) keeps its record, so a refresh
still never blanks content that is already correct.

## Surface

| Module / route | Purpose |
|---|---|
| `app/_lib/job-ingest.ts` | `setJobStatus`, `getJobStatus`, `isJobOpenForApplications`, draft/published/closed lifecycle. |
| `app/api/jds/route.ts`, `app/api/jds/save/route.ts` | Manual paste / AI-builder save + best-effort ingest. |
| `app/api/jds/save/ingest-job.ts` | `ingestStructuredJob` — JD → structured `jobs` row. |
| `app/api/jds/[slug]/**` | Analyses, retry-analysis, revisions, per-slug JD read, `ingest-job` (make a saved JD matchable). |
| `app/api/jobs/route.ts`, `app/api/jobs/[id]/route.ts` | Job listing / read. |
| `app/api/jobs/[id]/publish/route.ts` | Draft → published + source into Pipeline. |
| `app/api/jobs/[id]/close/route.ts` | Published/draft → closed + withdraw in-flight entries. |
| `app/api/jobs/[id]/campaign/route.ts` | Sourcing campaign pack (E1). |
| `app/api/jobs/[id]/rediscover`, `app/api/jobs/[id]/candidates`, `app/api/jobs/[id]/winnability` | Re-surface past candidates, candidate list, winnability signal. Every by-id job route re-applies the list's visibility predicate (`jobVisibleToWorkspace`: the shared seeded corpus plus the caller's own openings) and 404s otherwise — including the candidates ranking and its `candidates/outreach` write, which used to skip it and would rank the caller's pool against, or file an entry under, another team's role. Pinned by `lifecycle-signals.test.ts`. |
| `app/api/jobs/ingest/route.ts`, `app/api/jobs/status/route.ts` | Bulk ingest / status listing. |
| `app/_lib/jd-lint.ts` | Live specificity linter (E7). |
| `pipeline/jobfit/campaign.py`, `campaign_cli.py` | Campaign pack generation engine (E1). |
| `app/features/library/jobs/**` (`JobsDraftsPanel.tsx`, `JobsPostingModal.tsx` / `jobsPostingModalLogic.ts`) | Jobs tab UI: drafts list, publish/close actions, campaign tab. |

## Fair Rank reads the cross-scheme matrix in lockstep or not at all

The posting modal's **Candidates** tab can re-rank the pool by the robust
cross-scheme mean instead of each candidate's own-weight score, and exposes the
per-candidate own / robust / delta audit table + CSV
(`jobsRecruiterCandidatesLogic.ts` → `JobsRecruiterCandidatesFairness.tsx`). The
matrix comes from `recruiter.fairness_check` as four index-aligned arrays
(`labels` / `candidateIds` / `own` / `mean`) that cross an unvalidated
Python→JSON boundary.

The indexing gate therefore covers **every** array it reads, `own` included. It
previously compared `candidateIds` against `mean` only while the body still read
`own[i] ?? 0`, so a short `own` would have fabricated an own-score of 0 and a
delta of the full mean — an invented "under-rated by their own weights"
advantage on the one surface that exists to be bias-defensible. A matrix that
cannot be read in lockstep now leaves the map empty, which hides the Fair Rank
toggle and the audit panel (the same honest "not assessed" stance
`assessRobustness` takes for the group eval), and the CSV writes an empty delta
cell rather than a number derived from a missing side.

## Rediscovery shows a page, and says when it is one

`rediscoverForJob` slices its ranked silver medalists at `REDISCOVER_LIMIT` (20)
and returns the remainder as `more`; `GET /api/jobs/[id]/rediscover` forwards it.
`JobsRediscoverPanel` dropped that number, so a pool holding 35 qualifying past
candidates rendered its top 20 under an intro that describes the list as "past
candidates who clear the bar for this role" — a cut slice presented as the whole
set, on the surface whose entire promise is that nobody falls through the cracks.
The panel now appends the shared `match.card.moreCount` line ("+15 more") below
the list whenever `more > 0`. The **standing** feed (`JobsRediscoveryFeed`) is a
separate, alert-backed surface and is not paged this way.

A failed sweep in that feed also stopped wearing the success tone: `note` carries
either the sweep's outcome ("Checked 12 roles: 3 new matches") or its failure, and
the failure was painted `text-moss` — this app's "it worked" green — whenever any
alert was already on screen.
The tone now travels WITH the line (`FeedNote = { text, tone }`) instead of being
re-derived by comparing the rendered string against one known failure message.

Two more honesty gaps in the same feed closed with it. The **initial** GET used to
collapse failure into emptiness — a 500 set `alerts` to `[]` and the panel said
*"No silver medalists right now"*, a claim about the pool it could not make; it now
renders a red `loadFailed` line with a **Retry** that re-reads the alerts (not a
re-sweep, which would re-rank every published role's pool). And **dismiss**, which
was optimistic with no rollback, now remembers the row's index: a PATCH that fails
or never lands puts the candidate back where they were and says the dismissal did
not stick, instead of leaving them gone from the view and open on the server.

A rollback now restores **one** truth. The add flow keeps the row for a beat so the
green "Added ✓" badge renders, then dismisses it on a timer; when that deferred
PATCH failed, the restored row carried the green badge AND the red *"Couldn't
dismiss that match"* note at once. The rollback drops the added mark with the row
(`dropAddedMark`, `jobsRediscoveryDismiss.ts`), and the deferred timer is registered
so an unmount inside the beat cancels it rather than running a PATCH and two
setStates into a torn-down panel. The extract/restore/rollback trio is pure and
pinned by `jobsRediscoveryDismiss.test.ts`.

## A response body is not guaranteed to be JSON

Every fetch in the jobs workspace decodes through `.json().catch(() => null)` and
folds the result (`jobsResponseFold.ts`): a **failed** status keeps the parsed body
so `errors.<code>` still resolves in the reader's language; a **malformed** body — an
unparseable one (a proxy's HTML 502), or a 200 missing the field the surface needs —
answers its own localized line (`jobs.ingest.malformedResponse`,
`jobs.candidates.malformedResponse`) rather than painting the raw `SyntaxError` text
into the panel in English. The ad-ingest POST and the candidates GET were the last
two bare `r.json()` awaits; both now fold.

## Ingest: cancel is an outcome, unmount is not

The ad-ingest panel drives one `AbortController` for two different events, and
`settleBulkRun` / `settleSingleRun` (`jobsIngestRunOutcome.ts`, pinned by
`jobsIngestRunOutcome.test.ts`) is the decision that separates them. A recruiter's
**Cancel run** is terminal: the rows that landed stay on screen, busy clears, the
note says how far it got, and the corpus refreshes only if something was created. An
**unmount** writes nothing at all. The same module owns the paste rule — a bulk run
that created nothing (`added === 0`, every ad a dedup hit or a parse failure) KEEPS
the textarea, because that paste is the only copy of the text the recruiter needs to
fix and re-run.

## The campaign-pack CTA is keyed to the role on screen

The posting modal's pack-existence probe (`GET /api/jobs/[id]/campaign?lang=`) runs
under the same latest-request guard as the candidate ranking, keyed by job **and**
posting language via `requestKey` (`jobsRequestGuard.ts`). The modal is reused across
roles, so an unguarded probe for Role A resolving after the switch decided Role B's
CTA from A's answer — offering "View campaign pack" for a pack B has not got. The
probe is aborted when the modal changes role or unmounts, and `packExists` resets
with the role so no frame of the previous role's CTA is painted.

## The Candidates tab says when the pool was capped

`GET /api/jobs/[id]/candidates` returns `poolTruncated` ("the corpus exceeds the
pool caps, so some candidates were never scored here" — the overflow is excluded,
not ranked low). The tab shipped that flag unread: `jobsRecruiterCandidatesLogic.ts`
typed only `candidates` / `skipped` / `fairness`, so an over-cap workspace saw a
ranking, a KO-filtered count and a Pool-Fit count all computed over a subset,
presented as the pool — the same cut-slice-as-whole-set shape the rediscovery
panel closed with its "+N more" line. The hook now reads the flag (strictly
`=== true`, so an older payload never invents a warning) and
`JobsRecruiterCandidates` renders `jobs.candidates.poolTruncatedNote` beside the
skipped-candidates note, in the same advisory amber.

**The fairness audit repeats it.** That amber note sits ~30 lines above a
collapsed `<details>`, so a compliance reviewer who opens the audit panel — or
opens the exported CSV weeks later, having never seen the tab — was reading a
cross-scheme ranking over a subset with nothing beside it saying so.
`FairnessAuditPanel` now takes `poolTruncated` and renders
`jobs.candidates.auditPoolTruncated` INSIDE the panel, and `exportFairness`
writes the same sentence as the CSV's first line above the header row. The
caveat travels with the artifact, not with the screen it came from.

### Memo boundaries on this surface, named

Every cohort here was re-derived in a render body: `eligible`, the pool-fit
filter, the two column splits and the not-eligible list are five walks over the
whole ranked pool, and the audit panel did a map + full sort in render — all of
it re-run on every add, every reach-out and every toggle. They are now one
`cohorts` useMemo keyed on `(data, poolFitOnly)`, a memoized `fairById` /
`orderRows` / `fairLookup` / pre-ordered column arrays, and `memo()` boundaries on
`CandidateColumn`, `JobsRecruiterCandidatesCard`, `NotEligibleSection`,
`FairnessAuditPanel` and `JobRow`. The card and row handlers take the ROW
(`onAdd(c)`, `onOpen(job)`) rather than being pre-bound by the parent, because an
inline arrow per row is a fresh identity per render and would leave the memo
structurally present and behaviourally dead; `useEnumLabel` is hoisted out of
`JobsRow` and `JobsRediscoveryFeedRow` for the same reason (one `enums`
subscription per list, not per row). A memo boundary is invisible in a screenshot,
so the set is pinned by name in
`app/features/library/jobs/jobsCandidatesMemo.test.ts`.

The **winnability coach's half is now closed too**. `GET /api/jobs/[id]/winnability`
destructured `{ entries }` only, so the coach graded the same capped pool and
presented "3 of 40 qualify — loosen this gate" as the whole truth; a recruiter
edits their JD off that number. The route now reads `{ entries, truncated }` and
echoes `poolTruncated` exactly as the candidates route does, and `JobsCoachPanel`
renders **the candidates namespace's own sentence** (`useTranslations("jobs.candidates")`
→ `poolTruncatedNote`) rather than a second copy of it, so the two surfaces cannot
drift into two accounts of one cap. The empty-pool branch's English `note` ("No
saved candidates yet.") is gone with it — no client ever read it, and a client is
not allowed to render server prose. Pinned by
`app/features/library/jobs/jobsCoachPoolCap.test.ts`.

## A rediscovery prior must be another role

`pickPrior` (`app/_lib/rediscover.ts`) picks the one past outcome that justifies
resurfacing a candidate. Its `elsewhere` branch always required `jobId !== jobId`;
the `rejected` and `closed` branches did not — so a candidate the team had rejected
from **this very role** was re-listed as a silver medalist **for** it, chipped
`Rejected · <this role's own title>` and floated up the list by the
`priorDepthBoost` they earned inside it. Reachable on every genuine go-live (publish
raises standing alerts, and a closed→re-published role keeps its rejects) and on
every Rediscover-panel open. Prior selection now reads only other-role history, per
the module's stated contract ("people rejected/closed *elsewhere*… who aren't
already in it"). Nothing legitimate is lost: re-publish already reinstates the
role's own `role_closed` entries to `active` (`reopenEntriesByJobId`, which runs
*before* the alert raise), and the reach-out linker has always excluded the target
role (`terminalPriorEntriesForCandidate`'s `job_id != ?`).

## Dismissing a standing alert is workspace-scoped

`dismissRediscoveryAlert` (`app/_lib/rediscovery-alert-store.ts`) wrote
`WHERE id = ? AND dismissed_at IS NULL` with no tenant predicate. An alert id is not
a capability token — `listRediscoveryAlerts` hands it to every recruiter in that
team's feed — and dismissal is sticky (the `UNIQUE (job_id, candidate_id)` index
makes every later sweep an `INSERT OR IGNORE` no-op), so any holder could
permanently suppress another team's silver-medalist alert. The write now filters
`workspace_id` too; `changes > 0` answers "already dismissed", "never existed", and
"not yours" identically. The source guard (`rediscovery-tenancy.test.ts`) used to
strip every statement containing `id = ?` before asserting — that blanket carve-out
is what let the unscoped write ship — and now keeps an explicit allowlist of literal
exempted statements instead. It holds exactly the two retention `DELETE`s below —
clock-scoped, age-only sweeps that can neither surface nor suppress one team's alert
inside another's feed.

## Rediscovery honors consent before it ranks, and its alerts expire

Consent gated rediscovery at ONE door — the *Reach out* send in
`app/api/candidates/[id]/outreach/route.ts`. Everything upstream ran on the whole
pool, so an anonymized (Art. 17 erased) or lapsed-consent person was still ranked,
still persisted as a `rediscovery_alerts` row carrying their **label**, and still
rendered in the standing feed and the Rediscover panel. The predicate that would
have excluded them — `candidateOutreachSuppression` — lives in the very module that
writes the row and was never called there, so an erasure removed a person's data
from the pipeline and rediscovery put their name straight back on a shared screen.

Two walls close it, both in the rediscovery module:

- **At rank time.** `rediscoverForJob` resolves `suppressedCandidateIds` (the batch
  form of the same person-level gate: one SELECT for the whole pool, most-restrictive
  across every entry the `candidate_id` owns) and ranks only the eligible remainder.
  Their data is not processed for this purpose at all, and the payload handed to
  `recruiter_cli` shrinks with it. The result reports a **count** (`suppressed`), never
  a list — naming them in `skipped` would put the identity back on the wire the
  suppression exists to keep off it.
- **At write time.** `recordRediscoveryAlerts` refuses a suppressed candidate, so no
  future caller can persist an unconsented alert past the first wall.

A read error still fails **closed** (surface nobody rather than everybody); the one
exception is a missing `pipeline_entries` table, which is a logical identity — no
table means no entries means no consent record can suppress anyone — not a loophole.

**Retention.** `rediscovery_alerts` had no `DELETE` anywhere in the tree: dismissed
rows are kept deliberately (the `UNIQUE (job_id, candidate_id)` index is what makes
dismissal sticky) and un-acted-on ones simply accrued, each holding a candidate's
name for a re-contact that never happened. `pruneRediscoveryAlerts` now drops
dismissed rows past `ALERT_DISMISSED_RETENTION_DAYS` (30) and undismissed ones past
`ALERT_STALE_RETENTION_DAYS` (90), from the clock in `instrumentation-node.ts`
beside the apply-session retention sweep and under the same autonomy pause.

## A failed ranking is reported, not folded into a zero

`raiseRediscoveryAlertsForJob` swallowed every failure into `return 0`, with no log
line — so a publish whose `recruiter_cli` died told the recruiter *"0 silver
medalists"*, indistinguishable from a clean run that found nobody, and the sweep did
the same across every role. It now logs with the job id (an abort — the per-role
timeout or a client hang-up — warns quietly; anything else is `console.error` with
the stack) and returns `{ raised, failed }`. `POST /api/jobs/[id]/publish` adds
`silverMedalistsFailed` and `POST /api/rediscovery/alerts` adds `failedJobs` to its
`{ jobsSwept, newAlerts, truncated }` — both additive, so existing consumers are
unchanged, and neither is rendered yet (`jobsPublishResult.ts` /
`jobsRediscoveryFeedLogic.ts` still read the counts alone).

An **unscored** candidate is likewise no longer a low-scoring one: a missing/
non-finite `result.total` folded to `0` and lost to `SCORE_FLOOR` silently, so a
candidate whose scoring *failed* vanished instead of joining the `skipped` list that
exists to say "this person was not evaluated". Such rows now join `skipped` with
reason `unscored`; only a real number is compared against the floor.

## The sweep ceiling defers, it does not exclude

`sweepRediscoveryAlerts` bounds a Refresh three ways (worker-pool concurrency, a
per-role timeout, and `SWEEP_MAX_ROLES` roles per sweep). The ceiling sliced the
first N ids off a stable list every time (`listJobStatuses` has no `ORDER BY`), so
"deferring N to the next Refresh" was false — the next Refresh re-swept the
identical prefix, and a catalog above the ceiling could never surface a silver
medalist for the roles past the cut. Sweeps now rotate: a per-process,
per-workspace cursor resumes where the previous one stopped. The ceiling, pool, and
timeout are unchanged — only *which* roles a sweep covers. The cursor is
deliberately not persisted; re-sweeping a role is idempotent
(`recordRediscoveryAlerts` is `INSERT OR IGNORE`), so losing it on restart only
restarts the rotation.

## The JD ledger shows each role's live pipeline

The saved-JD table carries a **Pipeline** column: a stacked shape bar
(`app/_components/ui/PipelineShapeBar.tsx` — width encodes volume against the
busiest role, segments encode reached-interview and hired), the headcount, and
the hires when there are any. It arrived from an Analytics prototype whose
per-role league table proved useful but was one tab away from where a recruiter
actually looks at their roles.

- **Source:** `listJobPipelineStats()` (`app/_lib/db/pipeline.ts`) — one GROUP BY
  for every job, composed into `GET /api/jds` beside the existing
  `listJobStatuses` / `listJobRoleMeta` / `countAnalysesByJd` passes.
- **Join key is `job_id`** (`jdJobId(slug)` → `jd-<slug>`), the same key the
  Field/Seniority/Status columns already use — not the title. Analytics' `byJob`
  groups by TITLE because it reports on roles as the recruiter names them; this
  reports on one JD's linked job.
- **"Reached interview" is `hasAdvancedPastScreening`**, the single source
  analytics uses, so the two surfaces cannot report different numbers for the
  same role.
- **No linked job renders `—`, never `0`.** "This JD was never ingested" and
  "this role has nobody in it yet" are different facts; the sort accessor returns
  `null` for the first so it sorts last in both directions rather than ranking as
  a zero and burying real-but-quiet roles.
- The quantitative columns (Pipeline / Analyzed / Saved) sort via the shared
  `app/_components/table/ColumnHead` + `useTableSort` and carry `aria-sort`. The
  categorical ones keep their existing filter-trigger headers — `ColumnHeaderFilter`
  here has no icon-only mode, so nesting it would print the column name twice.

> Note: a seeded/demo database can show `—` on every row. Seeded corpus jobs
> (`job-000…`) are ingested directly and are not JD-backed, so nothing joins.
> The column populates for JDs ingested through the library's own "Ingest as job".

## The job modal's lifecycle strip reads stage ROLES, not stage names

`JobsLifecycleStrip.tsx` renders this role's chain — JD → **assignments** → channels
listening → funnel → decisions → slots → **offers out** → **hired** — each segment
deep-linking the tab that owns it. The last two are stage questions, and the
board's axis is workspace data (Settings → Hiring composes it; see
`app/_lib/pipeline-stages.ts`), so both the counts and the `?stage=` link value
resolve through `stageHasRole` / `stageWithRole` against the axis that arrives
with the entries (`GET /api/pipeline` answers `{ entries, stages, retiredStages }`).
Reading the literals `"Offer"` / `"Hired"` counted zero on a renamed axis: the two
segments vanished from a role that had live offers and hires, and the one link
that did render carried an id the workspace's own board resolves as off-board.
An axis with no offer (or no terminal) column renders no such segment rather
than a dead link. Pinned as a source guard by `jobsLifecycleStrip.test.ts`, the
same shape as `pipelineStageFilter.test.ts`.

The strip is best-effort — a failed load renders nothing — which now includes a
**non-2xx** response, not only a thrown fetch: `safeJsonError` answers valid
JSON, so `p.entries ?? []` used to turn a 500 into a confident "0 in funnel".

### The assignments segment (one thread: JD → assignment)

A role's work samples are now on the strip because they are now in the schema:
`dev_cases.job_id` holds the `jd-<slug>` id of the JD the case was cut from (see
[the dev-case doc](../dev-case/README.md)). Before that column, the recruiter's JD pick
survived only inside an opaque `need_json` blob, so nothing in the Jobs surface could
tell that a role had an assignment at all.

`GET /api/jobs/[id]/assignments` answers the count — workspace-scoped, and an
identity-only projection rather than the case rows, because a case payload carries its
whole internal design (rubric, covert probes). Unlike the two fetches above it filters
SERVER-side; the segment renders only when there is at least one assignment, since a
role without a work sample is the normal case and not a gap to nag about. The count
stays `null` until the fetch lands and after a failure, so an unknown count is an absent
segment rather than a confident "0".

## The posting modal's tab strip is a real tablist

`JobPostingModal` renders seven tabs under `role="tablist"`, and until now that
was ARIA the widget did not honour: every button was a tab stop and no arrow key
did anything, so a keyboard user reaching **Agent fit** from **Posting** paid six
Tab presses through a strip that announces itself as one control. The strip now
carries a roving tabindex (`tabIndex={tab === id ? 0 : -1}`) and ←/→/↑/↓/Home/End
movement, and it scrolls horizontally (`overflow-x-auto`, `shrink-0` tabs) instead
of squeezing seven labels off a narrow modal's edge.

The ids live once, in `jobsPostingModalTabs.ts` — literal array → derived union →
runtime guard, the same shape as `app/features/shell/tabs.ts` — with the label +
icon per id in a `Record<PostingTabId, …>` in the modal, so adding a tab id is a
type error until the strip learns to render it. The movement arithmetic is
`SegmentedControl`'s `move`, **copied** rather than shared: that primitive's copy
is entangled with its radiogroup semantics (`aria-checked`, the off-taxonomy
recovery, the `layoutId` indicator). Both halves are pinned by
`jobsPostingModalTabs.test.ts`.

Two more shapes moved off hand-rolled strings in the same pass: the shared
`Modal` footer wraps (`flex-wrap`) — this modal's footer carries up to six
actions plus a publish note, and on a narrow viewport they were squeezed rather
than wrapped, while the `basis-full` copy-failure line already assumed a wrapping
row — and the jobs surfaces compose `PANEL` / `STAT` / `CHIP_TOGGLE` from
`app/_components/ui/recipes.ts` (the Agent-fit status, coverage and spec panels,
the campaign variant card, the coach's stat tiles, and the four language /
filter chip toggles) instead of re-typing the class strings, so a restyle reaches
them and Spark Dark's sticker treatment applies without a second edit.

The modal's own lifecycle machine is extracted too: `derivePostingLifecycle`
(`jobsPostingLifecycle.ts`) folds the server-decorated `job.status` together with
the in-session `closed` / `published` flips. `published` is read FIRST, because a
re-publish IS the reopen path — reading `closed` first would keep the apply links
inert on a role that is live unless every caller remembered to clear the flag by
hand. Pinned by `jobsPostingLifecycle.test.ts`; the Campaign tab's `(job, lang)`
staleness rule moved to `jobsCampaignPackKey.ts` with the same treatment.

## The winnability coach stages the number it actually computed

The Coach tab's loosen list (`JobsCoachPanelLoosenList.tsx`) can hand a
recommendation into the JD editor with the change staged
(`jobsCoachApply.ts` → `?coachEdit=<kind~slug~delta~value>`), where
`JdsModalEditorStagedBanner` spends `delta` as "could shortlist up to +N more
candidates". That N is the coach's `qualifiedDelta` — the result of
`winnability.py` re-running `score_job` with the must-have demoted — and nothing
else. A must-have whose demotion frees nobody comes back `qualifiedDelta: 0`, and
the banner's `=0` plural branch drops the claim instead of substituting
`missingAmongEligible` (how many *eligible* candidates lack the skill, a different
question) as a gain the scorer had already ruled out.

The education row is a real lever, not JD-text theatre: `min_education` is a hard
gate in `ko_filter` (`matching.py`, ranked through `_EDU_RANK`), the coach's
`+N` comes from an actual counterfactual re-run with `min_education="none"`, and
saving the JD body re-ingests the linked job (`app/api/jds/[slug]/route.ts`) so
the re-parsed floor moves eligibility by that amount.

## `ingestJobAd` parses; `insertJob` persists — both, or the claim is a lie

`ingestJobAd` (`app/_lib/job-ingest.ts`) spawns `jobs_cli ingest` and returns the
structured `Job`. It writes **nothing** — the Python side has no database, and
`insertJob` is the sole writer of the `jobs` table. Every caller must pair them,
the way `POST /api/jobs/ingest` does.

Three JD routes called only the first half and still reported success:
`POST /api/jds/[slug]/ingest-job` spent a Claude ad-parse and answered
`{ ok: true, already: false, jobId: "jd-<slug>" }` with no row written (so the
Ledger row stayed `unlinked`, "Source into Pipeline" 404'd, and each re-click
re-spent the parse); `PATCH /api/jds/[slug]` and `POST /api/jds/[slug]/revisions`
answered `jobResynced: true` while the matchable job kept the
requirements/education floor parsed from the *pre-edit* (or just-reverted) text —
which is exactly the coupling the education-lever paragraph above depends on.
All three now persist under the explicit `jd-<slug>` id, deliberately **without**
a content hash: the JD↔Job identity contract (`jdJobId`, `app/_lib/jd-limits.ts`)
must win, and `insertJob`'s content-twin dedup would otherwise file the parse
onto an unrelated job and leave the JD unlinked behind an `ok: true`. The pairing
is pinned by `app/api/jds/save/save-ingest-contract.test.ts`.

### The Ledger modal has to agree with `if (getJob(jobId))`

The resync in `PATCH /api/jds/[slug]` runs **only** when a `jd-<slug>` job already
exists; on an unlinked JD the route skips it and returns `jobResynced: false`. The
in-modal editor printed `library.tab.editLinkedNote` ("Edits update the linked role
too. Its live or draft status is preserved.") unconditionally — describing a write
the server never performs, while the rail one column over showed the **Unlinked**
chip and an "Ingest as job" button. `JdsLedgerDetailModal` now passes
`linked={!isUnlinked(effRow)}` and `JdsModalEditor` renders the note only then.

The same rail gated its "Ingest as job" button on the *snapshot* row rather than
`effRow` (the polled status). Because `statusCategory` returns `analyzing`/`failed`
ahead of the linked-job status, a modal opened mid-build kept `isUnlinked(row)`
false after the poll flipped the JD ready — Unlinked chip, no way to ingest until
the modal was closed and reopened — and after a Retry the stale `ready` snapshot
left the button live during the rebuild, one click away from spending an ad-parse
on the pre-retry body. Both directions read `effRow` now.

### A MINTED job id is not a claim on an existing row

A prose ad carries no id: `normalize_job` (`pipeline/jobfit/jobs.py`) mints one
with `_slug_from_title` — a bare slug of the ad's title, no uniqueness component.
`insertJob` used to read *any* pre-existing row under `job.id` as "the caller
means update THAT job", which is right for an explicit `jd-<slug>` and wrong for
a minted slug: two different roles sharing a title (a bulk req-list paste with
"Java Developer" in Prague **and** in Brno) slugged to the same id, so the second
ad's `ON CONFLICT … DO UPDATE` overwrote the first role's title/company/salary/
payload. Two roles merged into one and the panel reported the second as
"already in the catalog". Across tenants the same write crossed the boundary: the
row keeps its original `workspace_id` and `status`, so team B's paste rewrote
team A's **live** opening (still accepting applications, now under B's ad text)
while B's own catalog gained nothing.

`insertJob(job, hash, status, ws, { derivedId: true })` marks the minted case:
the content-hash dedup still resolves a genuine re-ingest first (no `-2` churn on
a retry), and only a real collision forks — `java-developer`, `java-developer-2`,
… — with the payload re-stamped so the stored record carries the id it lives
under. `POST /api/jobs/ingest` passes it whenever the caller named no `jobId`.
Behavioral coverage: `app/_lib/job-ingest.test.ts`.

### By-id job routes re-apply the list's visibility predicate

`getJob` is a by-id point read over a globally-unique PK (the documented
`jobs-tenancy.test.ts` exemption), so *any* `/api/jobs/[id]/*` route answers for
*any* tenant's job unless it re-checks `jobVisibleToWorkspace(id, ws)` — the by-id
form of the list's `(workspace_id IS NULL OR workspace_id = ?)` predicate. All of
`campaign` (GET + POST), `winnability`, `rediscover`, `agent-fit`, `candidates` and
`candidates/outreach` now do, ahead
of the spend, answering `404` (never `403`, so the endpoint can't confirm an id
exists); seeded corpus rows stay visible to every tenant. The last two were the
family members the first pass missed, and they are the two that cost the most when
ungated: `GET .../candidates` spawns a `recruiter_cli` child fed the role's title,
body and stated band, and `POST .../candidates/outreach` files a pipeline row
stamped with that role's title *and* drafts a paid first-touch mail from it — so a
caller could source and contact against another team's private opening. `POST /api/jobs/ingest`
carries the write-side twin — an explicit `jobId` is a content overwrite of a
named row, so it gates on `canWriteJobLifecycle` exactly like `/close` and
`/publish`, before the Claude ad-parse is spent. Pinned by
`app/api/jobs/lifecycle-signals.test.ts`.

### The JD content-CAS holds the write lock from its SELECT

`updateJd` and `revertJd` (`app/_lib/db/jobs.ts`) are read→compare→write: they
SELECT the live body, refuse the write when it no longer equals the editor's
`baseBody` (`{ ok: false, reason: "conflict" }` → the route's 409), snapshot the
pre-edit version into `jd_revisions`, then overwrite. Both run `tx.immediate()`,
not a bare `tx()`. A DEFERRED transaction takes only a shared read lock at the
SELECT and upgrades at the first write, so a second connection can pass the same
CAS check inside that gap and both writes land — last-write-wins, which is the
exact failure the CAS exists to prevent, and the one whose recorded snapshot is
the *intermediate* state. IMMEDIATE takes the write lock at BEGIN. This is the
locking half of `.claude/CLAUDE.md` § "A read→compute→write either locks or
re-checks"; `updateIntakeDialog` in `intakes.ts` is the same shape for the same
reason. Pinned behaviorally (a stale base is still a conflict) and at the source
by `app/_lib/db/jds-store.test.ts`.

### The JD library answers its own size

`GET /api/jds` took no `Request` and called `listJds(200, ws)`, so the `?limit=`
the analyze picker had been sending since `JD_LIBRARY_LIMIT` landed was unreadable
by construction, and the answer was a bare `{ jds }` — a slice cut at a server-side
constant, presented as the library. The jobs list beside it has answered
`{ truncated, limit }` since `listJobsPage`.

The store now holds the same contract:

| Read | Answers | Use it for |
| --- | --- | --- |
| `listJdsPage(limit?, ws)` | `{ jds, truncated, limit }` | the list surfaces — one page, and whether it was cut |
| `jdLibraryStats(ws)` | `{ total, analyzing, failed, newest }` | any COUNT claim about the library |

`listJdsPage` clamps like `listJobsPage` does: a missing/NaN/zero/negative/
fractional `limit` falls back to `JDS_PAGE_DEFAULT_LIMIT` (100) and anything larger
is capped at `JDS_PAGE_MAX_LIMIT` (200) — SQLite reads `LIMIT -1` as *unbounded*, so
the clamp is the guard, not a nicety. It reads one row past the page to set
`truncated` without a second COUNT round-trip, and orders `created_at DESC, rowid
DESC` so same-millisecond saves cannot make the page head and `jdLibraryStats.newest`
disagree.

Callers: the route (reads `?limit=`, forwards `{ jds, truncated, limit }`),
`computeGettingStarted` (deliberately a page — a truncated page is never empty, so
no branch of `firstRole` can change), and the command palette's `resolveLibrary`,
which now reads `jdLibraryStats` instead of folding `listJds(200).length` into
`total` — a team with 240 saved JDs was shown "200", with analyzing/failed tallies
that stopped at the slice edge. Pinned by `app/api/jds/jds-list-route.test.ts` and
`app/_lib/db/jds-store.test.ts`.

### The revision history has a table cap, not just a read cap

Every `updateJd`, `revertJd` and `finishJdAnalysis` INSERTs a FULL body copy into
`jd_revisions`. `listJdRevisions` capped the READ at 100 rows, but nothing capped the
TABLE — a JD edited in a loop, or rebuilt by the analysis pipeline repeatedly, grew
the row store without bound for the life of the install, invisibly, because the UI
only ever reads the head of it.

`pruneJdRevisions` keeps the newest `JD_REVISIONS_MAX` (50) snapshots per
`(slug, workspace_id)` and runs INSIDE each caller's existing IMMEDIATE transaction,
so the insert and its prune are one step. `revertJd` passes the revision it is
restoring from as `keepId`: pruning the row a recruiter just chose to come back to,
in the same transaction that restores it, would delete the only copy of that text.
Pinned by `app/_lib/db/jds-store.test.ts` ("the revision history is capped per slug"
and "a revert never prunes the revision it is restoring from").

### The builder's own contract, now under test

`app/_lib/jd-build-run.ts` is the largest and most expensive file in the JD area and
had no test at all. `app/_lib/jd-build-run.test.ts` drives its pure halves directly
and its FAILURE persistence through the real handler (the min-need contract refuses
before anything spawns, so the test reaches `failJdAnalysis` without paying for a
build); the success half is covered against the store by `jd-build-cas.test.ts`.

Three things changed to make that possible, and each closed a real seam:

- **One declaration of each option default.** `JD_BUILD_DEFAULT_OPTIONS` (what a
  caller who sends NO options gets: description + market research) and
  `JD_BUILD_NO_OPTIONS` + `readJdBuildOptions` (how a recruiter's EXPLICIT checklist
  is read: an absent box is unticked) both live in `jd-build-run.ts`.
  `POST /api/jds/generate` imports the reader instead of re-typing it; the two
  answers are different questions and the test pins them as such.
- **`composeJdBody`** isolates the template-vs-default branch, so both paths (and a
  blank template, which must fall back rather than persist an empty body after a
  1–2 minute build) are testable without a spawn.
- **`normalizeMarketSalaryPayload`** is the market-salary trust boundary as a pure
  function, drivable with the garbage the CLI can actually print.

**The repo snapshot is now read.** `runJdBuild` has persisted a `snapshot`
(`ref`, `languages`, `inferredStack`, `loc`) into `analysis_json` since repo
grounding shipped and nothing rendered it, so a JD grounded in a real codebase looked
identical to one written from a paragraph of prose — the recruiter could not tell
whether the must-haves came from the code or from the model's prior. The Ledger
detail now draws it beside the salary card (`RepoGroundingCard` in
`JdsLedgerDetailPanels.tsx`, gated by `hasRepoGrounding`), with the ref linked only
when it is a safe http(s) URL and `library.tab.repoGrounding` / `repoLoc` in all four
locales.

### The JD build has one door, and four throttled entrances

Four callers used to hand-roll the three-step start sequence (placeholder row →
detached `jd_build` task stamped with the same workspace → row↔task link):
`POST /api/jds/generate`, `POST /api/jds/[slug]/retry-analysis`, the companion's
`draft_jd` action and `POST /api/intake/[id]/promote`. A rule that lands on three
of four copies is worse than no rule — that is how the tenant stamp went missing
once (the JD row was created for the right team while its matchable opening went
to the default one). The sequence now lives once in
`app/_lib/jd-build-start.ts` (`startJdBuild` / `restartJdBuild`), which owns
`title`, `jdSlug` and `options` so a caller's params cannot point the task at a
different row or a different checklist than the row it just created.
`app/_lib/jd-build-start.test.ts` fails on any file that pairs
`insertAnalyzingJd(` with `startTask("jd_build"` outside the seam; the intake
promote route is the one allow-listed exception and the test also fails when that
exception goes stale.

All four JD spend doors now carry a per-IP limiter, answered through
`jsonRefusal("TOO_MANY_REQUESTS", 429)`. They are operator-gated, but open mode
(`KP_OPERATOR_PASSWORD` unset) makes that gate a documented no-op for the whole
API, so the limiter is the real bound. Each sits after the route's cheap refusals
(so a request that was never going to spend costs no budget) and before the write
and the spawn; the budgets and that ordering are pinned in
`app/api/rate-limit-contract.test.ts`.

| Route | Key | Budget | What one call buys |
| --- | --- | --- | --- |
| `POST /api/jds/generate` | `jd-generate:<ip>` | 20 / 10 min | the full 1–2 minute paid build |
| `POST /api/jds/[slug]/retry-analysis` | `jd-retry:<ip>` | 20 / 10 min | the same build, replayed by one click |
| `POST /api/jds/[slug]/ingest-job` | `jd-ingest-job:<ip>` | 20 / 10 min | one Claude ad-parse of the JD body |
| `POST /api/jds/save` | `jds-save:<ip>` | 30 / 10 min | a deterministic `jobs_cli normalize` child |

METERING the build — a per-workspace paid quota — is a separate billing decision
and is not what these limiters are.

### A landing build never overwrites an edit

The same rule now binds the build's OWN write. `finishJdAnalysis` used to be a
bare by-slug `UPDATE` of the body with no precondition and — unlike
`updateJd`/`revertJd` — no `jd_revisions` snapshot. A `jd_build` lands one to two
minutes after it starts, and `PATCH /api/jds/[slug]` accepts an edit for that
whole window (deliberately: the placeholder row is editable in the Ledger, and
refusing an edit the UI offers is the worse trade), so an operator who fixed an
`analyzing` row watched the build overwrite it with no snapshot, no conflict and
no trace.

`finishJdAnalysis` now runs `tx.immediate()` and takes the body only when the row
is still the untouched placeholder the build was started for —
`body = '' AND analysis_status = 'analyzing'`. Both conjuncts matter: `body = ''`
is the edit guard (only a build or an operator ever fills a placeholder), and
`analysis_status = 'analyzing'` is the finished-row guard, which the first does
not imply — a market-research-only build composes no markdown, so a `ready` row
can legitimately carry an empty body, and without the second conjunct a late or
duplicate run would overwrite its artifacts.

When the predicate fails nothing is thrown away: the composed markdown is filed
into `jd_revisions` (so the Ledger's revision list offers it and `revertJd` can
restore it), the artifacts and the `ready` flip still land (leaving the row
`analyzing` forever would be worse), the matchable `jd-<slug>` ingest is SKIPPED
(an opening must not answer text the JD does not show), and the task result
carries `bodyHeldAsRevision: true`, which the Tasks drawer renders — so the run
does not report a silent success. Pinned by `app/_lib/db/jd-build-cas.test.ts`.

## Reading the `jobs` corpus: a page is not a count, and "visible" is not "owned"

Two traps live in `app/_lib/db/jobs.ts`, both now named by primitives.

**`listJobs` is a PAGE.** With no `limit` it binds `LIMIT 300`; a caller-supplied
one is clamped to 500. `.length` on the result is the size of a slice, never a
count — the analytics metric pack read it that way and published "300 open
roles" (30 roles/recruiter instead of 35) for a workspace carrying 350, labelled
`measured`. Use:

| Primitive | Returns |
|---|---|
| `listJobsPage(filter, ws)` | `{ jobs, truncated, limit }` — the same `truncated` contract as `buildCandidatePool`, so a cut slice says so (it reads one row past the page to decide). |
| `listJobs(filter, ws)` | The bare array (unchanged for the catalog UI) — now a thin wrapper over `listJobsPage`. |
| `countJobs(filter, ws)` | The unbounded `COUNT(*)` over the *identical* predicate; `limit` is ignored. |
| `GET /api/jobs` | `{ jobs, stats, truncated, matching, limit }` — `jobs` is `listJobsPage`'s slice, `matching` is `countJobs` over the **same bound filter object**, and `truncated` says the slice was cut. `stats.total` stays the workspace-wide **unfiltered** count, so "300 of 340" (ordinary filtering) and "300 of 312 matching, cut" (40 roles the UI offers no way to reach) are finally distinguishable. |
| `listCorpusJobs(ws)` | Every live row as full records (the matcher/rematch corpus). |

**And the catalog UI now reads all three.** `useJobsList` returned only `jobs` +
`stats`, so the summary line said *"Showing 300 of 340 roles"* against the
workspace-wide UNFILTERED total — the very reading the `matching` field was added
to prevent. It now carries `{ truncated, matching, limit }` through to
`JobsTabResults`, which paints `jobs.tab.showingCut` (amber) — *"Showing the first
300 of 312 matching roles — the list is cut at 300"* — whenever the slice was cut,
and keeps the ordinary `jobs.tab.showing` line otherwise. Truncated and filtered
read differently on screen because they are different facts.

**And it really cancels now.** The hook's header has claimed since it was written
that "the in-flight request is cancelled on the next change/unmount". It was not: a
`cancelled` boolean was flipped and the socket stayed open, so typing eight
characters into the search box left eight live requests racing to the browser's
per-host limit, each decoding a full page of jobs nobody would read — and the last
one to *arrive* was not necessarily the last one *sent*. The effect now owns an
`AbortController`, hands its signal to `fetch`, and aborts in the cleanup before
clearing the debounce timer; `controller.signal.aborted` doubles as the "does this
attempt still own the state?" flag, so there is one cancellation mechanism rather
than a boolean beside a comment. The query and payload mapping are exported as
`jobsListQuery` / `readJobsListPayload` and driven by
`app/features/library/jobs/useJobsList.test.ts`, which also source-guards the abort
wiring. The Pipeline deep link and the ingest latch beside it are pinned by
`app/features/library/jobs/jobsTabDeepLink.test.ts`.

The same hook was the one jobs read that bypassed `useJsonFetch`: it threw
`Load failed (500).` in hardcoded English and the tab rendered it raw. It now keeps
the failure as `{ code, status }` and resolves it through `useErrorMessage()`, and
the route's seed-failure 500 answers `safeJsonError(..., "JOB_SEED_BROKEN")` — the
failing seed PATH goes to the server log instead of into the recruiter's red box.

**The dual-tier predicate `(workspace_id IS NULL OR workspace_id = ?)` shows a
team the shared reference corpus as if it were its own openings.** `listJobs`,
`listCorpusJobs` and `jobStats` all use it, and `JobRecord` carries no
`workspaceId`, so a caller could not tell the tiers apart. `countOpenRoles(ws)`
now splits them: `{ own, corpus, visible }` over the open-for-applications
predicate (`status IS NULL OR 'published'`). On the shipped DB a workspace that
has authored nothing reports `own: 0`, `corpus: 100`, `visible: 100`.

`jobStats` is workspace-wide and **unfiltered**, which is what makes the Jobs tab
header chips safe to read as one population while the table below is filtered. Its
entry-eligible chip prints the count and the share; at whole-number precision a
catalog with 1 entry-eligible role in 400 rendered `1 (0%)` — its own count
contradicting its own percentage — so a sub-0.5% share (and only that case) keeps
one decimal.

Whether a corpus role a team has *adopted* counts as a carried requisition is an
open product decision — the primitive makes the choice explicit at the call site
instead of hiding it in a predicate; it does not take the decision. Related but
distinct: `countPublishedJobs` (`job-ingest.ts`) is the billing active-jobs cap
and counts strictly `status = 'published'`.

## Data model

`jobs` (structured, matchable — `status`, `salary_min/max`, `payload_json`),
`jds` (JD markdown/title prose, separate from `jobs` by design), `campaign_packs`
(one row per job × language — see the constraint note above; the key does *not*
include `workspace_id`).

## Known gaps

- External "Publish to job boards" distribution is not implemented.
- **`/jds/[slug]` renders the recruiter shell to anonymous visitors.** The page is
  on the public allow-list (`app/_lib/auth/public-routes.ts`), but it wraps its
  content in `WorkspaceShell` (`app/features/shell/WorkspaceNav.tsx`), which
  computes `attentionCounts(await currentWorkspace())` server-side and renders the
  raw numbers as nav badges (`NavPanelItem`). A visitor with no session resolves to
  the DEFAULT workspace, so the candidate-facing share link ships that team's
  pending-decision / aging-pipeline / upcoming-interview / draft-role / new-inbound
  counts — plus the Settings, Billing and Analytics nav, a sign-out button and the
  command palette. Fixing it means a nav variant (or an `operator` prop) that drops
  the badges and the operator-only rail items for a non-operator viewer; the page
  already knows the answer (`isOperator()`).
- **The public JD page's saved-at stamp uses the server's time zone.** The date now
  formats in the visitor's locale, but `i18n/request.ts` returns no `timeZone` and
  `app/layout.tsx` passes `NextIntlClientProvider` only `locale` + `messages`, so
  every next-intl / `toLocale*` format falls back to the environment default —
  the server's zone during SSR, the browser's after hydration. Picking a zone
  (workspace setting? UTC? the JD's own?) is a product decision, not a patch.
- `campaign_packs` is keyed `(job_id, lang)` without `workspace_id`, so only ONE
  team can hold a pack for a given shared-corpus role + language. The second
  team's save is refused with an error instead of being silently lost; making it
  actually work needs a table rebuild onto `(job_id, lang, workspace_id)` in
  `app/_lib/db/core.ts`.
- `GET /api/jobs` now forwards `truncated` / `matching` / `limit` (see the table
  above), but **no client reads them yet**: `useJobsList` still stores only
  `jobs` + `stats`, so `JobsTabResults`' "Showing N of M" line keeps comparing a
  cut slice against `jobStats.total`. Plumbing the three fields through
  `useJobsList` into that line (and a load-more/pager) is the remaining half.
- **The JD editor's 409 recovery destroys the edit it tells you to re-apply.**
  `useJdEditor`'s content-CAS is correct — a concurrent write 409s instead of
  clobbering — but the only way forward from the conflict discards the draft. The
  copy reads "Reload to get the latest, then re-apply your edit"; in the ledger
  modal `editReload` calls `onDone`, which leaves edit mode and unmounts
  `JdsModalEditor`, taking `draftBody` with it. Re-saving without reloading is not
  an option either: `baseBody` is fixed at mount, so every retry 409s again. A
  recruiter who rewrote a long posting loses it with nothing to paste from.
  Fixing it means keeping the editor mounted across the reload and showing the
  server's latest body beside the draft (or at minimum offering the draft for
  copy) — new copy in all four locales, and it belongs in the shared hook so the
  public page's `JdActions` gets it too.
- **The JD Ledger states its size honestly, but still has no pager.** `GET /api/jds`
  answers `{ jds, truncated, limit, total }` (`total` from `jdLibraryStats`), and
  both surfaces now read it: `JdsSavedLedgerPanel`'s footer resolves through
  `jdLibraryFooter(visible, total, truncated)` (`jdsLibrary.ts`) and prints
  `library.tab.entryCountOfTotal` — *"200 entries of 240 saved"* — whenever an M is
  bigger than the N beside it or the route said the page was cut, falling back to
  the bare `entryCount` when there is no total to state. The analyze picker prints
  `analyze.jdLibraryTruncated` above the dropdown. Both folds are pinned by
  `app/features/library/jds/jdsLibrary.test.ts`.
  What is still open is REACHABILITY, not honesty: `filterAndSortJds` filters the
  page in memory and there is no pager, so a workspace holding 240 non-archived JDs
  is now correctly told it is seeing 200 of them but still cannot search the other
  40 from this screen. That needs server-side search or a load-more, not more copy.
- The campaign pack's `defaulted_fields` — the facts `normalize_job` *assumed*
  rather than read (`pipeline/jobfit/jobs.py`) — never reach the wire:
  `campaign.py` spends them internally to suppress unstated facts but the pack it
  returns carries only `warnings`. So a recruiter sees "no salary stated" but not
  "we assumed medior / Praha for you". Surfacing it is a `campaign.py` change
  (add the list to the returned pack) plus a line under the pack in
  `JobsCampaignTab`, not a UI-only fix.
- **The Fair Rank audit table ranks one number across cohorts it is not
  comparable within.** `recruiter.fairness_check` is handed *every* validated
  candidate, so its `own` / `mean` arrays include both fairness tracks **and**
  the KO-filtered ones. `FairnessAuditPanel` renders them as a single list
  sorted by `mean` descending with no track and no eligibility column — so an
  early-career candidate scored on *potential* is ranked against an experienced
  one scored on work history (the interleave the Candidates tab promises two
  paragraphs above it never happens: "never ranked on one number against
  experienced candidates"), and a candidate the KO filter rejected outright can
  sit at the top of the bias-defensible record. Fixing it needs `koPassed` +
  `track` passed down from `JobsRecruiterCandidates.tsx`, and a column label.
- No structurally-tracked, independently-provenanced editable salary band yet
  (would need its own `source: "manual"` marker, not a re-parse of the
  markdown).
