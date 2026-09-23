# Job & JD Management

Job descriptions move from an AI draft to a live, matchable role. This covers
the JD builder/lifecycle, structured job ingestion, the campaign-pack
generator, and the specificity linter that runs on saved JD bodies (ledger
and public editors), not on the Generate need prompt. Phrase findings are
click-to-highlight locators in the ledger editor.

The shared JD and template rich-text editor includes a link control. Select text,
enter an http(s) or mailto URL, and the editor stores the result as a Markdown
link using the same safe-link rule as the renderer.

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

- **Sorting** — SERVER-side since challenge-r07: a header click sets
  `useJobsList.sort` (`nextJobsSort`: the active column flips, salary and status
  open descending) and the route orders the WHOLE matching set before it cuts the
  page (see "The Roles desk window" below). `jobsTableView.ts` keeps the accessors
  as the reference semantics the SQL mirrors: a missing value sorts last in BOTH
  directions, and "not eligible" and "eligible, scored 0%" stay different facts.
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
- **Paging** — the shared 20-row `TablePager`, driven by the route's `matching`
  count. `useJobsList` owns the index beside the filters, sends it as
  `offset = pageIndex * 20`, and every filter or sort change returns to page 1; a
  window that comes back empty under the reader (a publish dropped rows) re-lands on
  the last page `clampPage` says exists.

  It is called **`pageIndex`, not `page`**, and the name is load-bearing: `page` on
  that hook is already the ROUTE's honesty triple (`truncated` / `matching` /
  `limit` — was the server's answer cut, and at what size), which is a different
  fact from which 20-row window the server answered. `JobsTabResults` reads both:
  the summary line renders `showing` with `matching`, the pager renders the index. They were briefly both named `page` after a merge,
  which is a redeclaration the type checker catches but a reader would not.

## Entry points

- `?tab=jobs` — the Jobs tab (drafts vs. published/closed, publish action). Its
  header carries **Import position** top-right (`IngestAdButton`), which opens
  the paste form directly under the header. The state is one
  `useIngestAdPanelLogic()` held by `JobsTab`, handed to the trigger, the form,
  and the empty-catalog launchpad's import CTA, so the three can never disagree
  about whether the panel is open; the
  trigger locks while a parse is in flight, because a run costs billed LLM time
  and its one deliberate exit is the form's **Cancel run**. Copy calls what is
  pasted a **job position**, not an ad — the corpus is roles, and the ad is only
  the format one arrived in. The launchpad's second route is a button that calls
  `ingest.setOpen(true)` (pinned by `jobsEmptyLaunchpad.test.ts`). A `?job=` miss
  offers the same ingest action, so a stale share link degrades to paste-the-ad
  instead of a dead-end notice (`jobsTabDeepLink.test.ts`).
- `?tab=library` — the saved-JD ledger (`JdsTab.tsx` → `JdsSavedLedger.tsx`); the whole page is the table now. It opens on the All-but-live filter so live roles (the Roles tab's business) do not clutter the shelf.
- `?tab=intake` — **Job intake**, the authoring tab (`JdsIntakeTab.tsx`): the intake dialog (default) and the AI JD builder (`JdsBuilder.tsx`, exported as `JdBuilder` via `JdsGeneratePanel.tsx`) behind one switcher. Authoring and the ledger were one page behind a Saved/Generate/Intake strip until the split; "which roles do I have" and "write me a new one" are two questions, and the ledger now opens on the answer to the first. The empty Jobs catalog's "draft a role" launchpad card routes here (`tab=intake`), not to the JD shelf. Entry-mode rule: `jdsIntakeTabEntry.ts` (see `docs/features/intake/README.md`). The tab header carries no cross-link back to the ledger: "Job descriptions" is its own sidebar row one click away, and the corner button bought nothing but a width cap on the intro. A successful **Generate** reads `{ slug, taskId }` from `POST /api/jds/generate` and replaces the old 4s queued chip with a durable status linking to `/?tab=library&jd=<slug>` (pinned by `jdsBuilderGenerate.test.ts`), so the recruiter can watch the row the paid run is filling in.
- `/jds/[slug]` — the public JD page (candidate-facing). The library detail rail copies that share URL (`origin + /jds/<slug>`) without a round-trip through the page. Live (non-archived) pages advertise `alternates.languages` for exactly the languages the page serves: the posting's source language plus every language the owning team holds a fresh posting translation for, plus `x-default` (see "The public JD page serves the stored translations" below). Each served `?lang=` variant is self-canonical; the bare path and an unserved `?lang=` canonicalise to the original. Archived pages set an explicit empty `languages` so the root layout's four `./?lang=` alternates are not inherited. The sitemap lists only non-archived JDs with a linked open opening; saved drafts and closed roles stay out of the public index.
- Recruiter `/api/jds/*` 404s answer `jsonRefusal("JD_NOT_FOUND")` so the client localizes a missing slug.
- `POST /api/jds` and `POST /api/jds/save` refuse empty/over-long fields with `jsonRefusal(fields.code)` (`JD_FIELDS_REQUIRED` / `JD_TITLE_TOO_LONG` / `JD_BODY_TOO_LONG`).
- `POST /api/jds/generate` returns `JD_BUILD_TITLE_TOO_SHORT` or `JD_BUILD_NEED_TOO_SHORT` for its minimum-input refusals, so the client can explain the 2-character title and 11-character need thresholds in the reader's language.


## Lifecycle stages

| Stage | What it means | Where it happens | Internal marker |
| --- | --- | --- | --- |
| **Generated** | AI has drafted a JD (RoleSpec + market salary + markdown) but nothing is saved. | `JdBuilder` → `JdBuilderResult` (in-memory). | — |
| **Draft** | The JD is saved and reusable for analysis/matching, but no candidates are sourced and it is not live. | `POST /api/jds/save` (AI builder) or `POST /api/jds` (manual paste). | `jobs.status = 'draft'` |
| **Live (sourced)** | The JD is live and matching candidates have been sourced into the Pipeline (they land at `Accepted`). | "Publish" button (`POST /api/jobs/[id]/publish`) — in the drafts panel and the posting modal. | `jobs.status = 'published'` |
| **Closed** | The role is retired: its apply link stops accepting applications, it drops out of the open catalog and the matching pool, and its in-flight pipeline entries in the caller's workspace are withdrawn. | `POST /api/jobs/[id]/close` (idempotent mirror of `/publish`). | `jobs.status = 'closed'` |
| **Published to job boards** | *(Not yet shipped.)* Distribute the JD to external job boards. | Disabled "Publish to job boards" button on `/jds/[slug]`, shown only when `canManage` (operator on the owning team). Anonymous share-link visitors never see it. | — |

A failed AI build stores `JD_GENERATE_FAILED` in `analysis_error`; the task keeps the original failure for operator diagnosis. The ledger panel resolves that machine code and never renders a traceback.

`setJobStatus` (`app/_lib/job-ingest.ts`) owns every transition; a seeded
corpus job with a `NULL` status is treated as already live. `Closed` was
added after the original two-state (draft/published) model to stop a filled
role from staying open forever — see `app/api/jobs/[id]/close/route.ts`.

### A shared corpus role's lifecycle is per team

A seeded corpus role (`jobs.workspace_id` NULL) is one row that every team sees.
Whether a team has closed it, how many hires it is open for and which languages it
is posted in are that team's facts, so they live in the `job_workspace_state`
overlay, keyed `(workspace_id, job_id)`. They are no longer kept on the shared row.
`setJobStatus`, `closeRoleIfOpen` and `setRoleOpenConfig` route a corpus row's writes
to the caller's overlay. Every read folds `COALESCE(overlay, jobs)`: the browse page
and its count, `countOpenRoles`, the rematch corpus (`listCorpusJobs`), `getJob`,
`getJobStatus`, `getRoleOpenConfig` and `classifyPublish`. The shared row's own
values are the base a team reads until it writes its own. A corpus role that was
closed before the overlay existed therefore still reads closed for every team.
Authored roles keep writing their own columns and never get an overlay row. The rule
is `jobLifecycleInOverlay` in `app/_lib/db/core.ts`.

- **One team's hire does not close the role for everyone.** The role-fill hook counts
  the team's hires against the team's target, then runs its compare-and-swap in the
  team's overlay. Each team's withdrawal sweep still runs at most once.
- **Recruiter doors read the caller's lifecycle.** `getJobStatus` and
  `getRoleOpenConfig` require a team. `getJob` keeps it optional because most callers
  read only the payload, and an omitted team means the filing team's view. Every
  gated route passes its session team, and so does every recruiter-only library module
  (the entry's or the task's team). A team that closed a corpus role sees it closed
  on the job page, in the palette preview and through the sim intake, and the
  translations tab offers that team's posting languages. `app/api/job-lifecycle-team.test.ts`
  checks every route the proxy gates, taking the public list from `public-routes.ts`.
  It has no exemption list.
- **The public apply door follows the filing team.** `getJobWorkspace` files a
  corpus role's public applicants into the default workspace. The apply routes, the
  apply pages and the public JD page call `getJobStatus(id, getJobWorkspace(id))`, so
  the door closes only when that team closes the role, whoever is signed in. A channel
  webhook's inbound door files into the webhook's team, so it reads that team's
  lifecycle. The team that minted a channel can shut it by closing the role.
- **Billing is unchanged.** `published_at` stays on the shared row and `billable`
  still reads it. A second team adopting a corpus role that another team already took
  live classifies as `{ already: false, billable: false }`: it sources into its own
  pipeline and is not debited. One routing exception keeps this exact. A legacy corpus
  row stored as `published` with no `published_at` stays on the shared path until
  it is closed, because moving that close into one team's overlay would change who
  pays for the next go-live. `app/_lib/db/job-workspace-state.test.ts` drives random
  three-team interleavings against the pre-overlay rule and asserts that every step
  charges what it charged before.

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

Empty `responsibilities` / `mustHaves` / `niceToHaves` collapse the same way
empty `{{about}}` already did: `renderTemplate` emits no hollow `- —` bullet, so
the section-collapse pass drops the heading and a generated JD does not publish
unfinished Requirements / Nice-to-have sections. A filled list still renders
markdown bullets. Pinned by `app/features/shared/renderTemplate.test.ts`.

Missing `{{title}}` / `{{company}}` no longer substitute the English literals
"Role title" and "Company". Those fallbacks are `library.templates.token.fallback_title`
/ `fallback_company`, resolved with the rest of the document-language tokens, so a
partial Czech (or German/French) render cannot leak English scaffolding.

Unknown `{{tokens}}` fail inside `validateTemplateFields` / `validateTemplateUpdate`
(`reason.code: unknownTokens`) rather than as a second, forgettable call at each
write door. POST `/api/templates` and PUT `/api/templates/[id]` still 400; a new
caller that only uses the shared validator cannot store `{{tilte}}`. Pinned by
`renderTemplate.test.ts`.

The seeded Company-standard header is `**{{company}}** · {{location}} · {{seniority}} · {{salary}}`.
Empty location collapses with the same middot contract as seniority/salary, so a
Prague-less draft still reads `**Acme** · Senior`. `findUnknownPlaceholders(DEFAULT_TEMPLATE_BODY)`
stays empty.

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

### …and a template list that is only PART of the library says that too

`listTemplates` (`app/_lib/templates-store.ts`) had no bound: every row a team could
see, each carrying a full markdown BODY, serialized on every JD-builder mount and every
open of the manager. It is now bounded — `TEMPLATE_LIST_DEFAULT_LIMIT` (200), raisable by
a caller to `TEMPLATE_LIST_MAX_LIMIT` (500) and clamped there, because an unclamped
caller-supplied limit is the missing bound with extra steps. The read looks ONE row past
the bound, so `truncated` is answered rather than guessed from a full page.

`GET /api/templates` returns `{ templates, truncated }`; `fetchTemplates` and
`loadManagedTemplates` both carry the flag through. Only the MANAGER acts on it
(`JdsTemplateManagerList` renders an info notice, `library.templates.truncated`): the
builder's picker choosing among 200 templates is not a claim about what exists, while a
panel titled "your templates" is. Pinned by `app/_lib/templates-store.test.ts` (bound,
clamp at both ends, exact-fit page not truncated, default still leads) and
`jdsTemplateManagerLogic.test.ts` (the flag survives the client; a non-`true` value is
false, never inferred).

The command palette's library preview reads `countTemplates`, a real COUNT, rather than
the bounded page's length — reporting a page size as a library total is the exact bug the
JD figure beside it was already fixed for (`app/_lib/palette-preview/resolve-library-tools.ts`).

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
`canManage` (Edit / Archive / History, plus Analyze CV and the job-board
Publish teaser) still requires `isOperator() && currentWorkspace() === owner`,
where `owner` is whichever of the two produced the row. A candidate on the share
link used to see Analyze CV (`/?tab=analyze&jd=`) and a disabled "Publish to job
boards" button in the same header as Apply — operator chrome on a job posting.
Those two now render only when `canManage`; Apply / Not accepting stay for
everyone. Pinned by `app/jds/[slug]/jdPublicHeader.test.ts`.

**Archived means not accepting.** The archived banner and `robots: noindex`
already claim the role is retired, but Apply used to key only on the linked
`jd-<slug>` job (`isJobOpenForApplications`). An archived JD whose job was
still open showed both the banner and an Apply CTA into `/apply/jd-<slug>`.
`isPublicJdApplyOpen` requires `!archived_at` as well; the closed-job dashed
chip (`notAccepting`) covers the archived case. The apply APIs still gate on
job status — this is the page predicate, so the CTA stops contradicting the
banner without waiting on a job-status write.

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
   implemented; the disabled "coming soon" button on `/jds/[slug]` is
   operator-only (`canManage`). A candidate on the share link does not see it.

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

- **The Campaign tab kept the code** (historical: the tab and `jobsCampaignTabLogic`
  are deleted as of 2026-09). It threw `d.error` into
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

The shared `rankPoolForJob` child has a 240-second process deadline, below the
Python runner's ten-minute hang backstop. A caller may request a shorter bound;
the group evaluation still applies its own 240-second stage deadline.

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
edit in the builder: EN+CS+DE+FR boilerplate phrases ("competitive salary", "dynamic
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

> The posting modal's **Campaign tab is gone** (2026-09, see "The Campaign tab
> left the posting modal" below); everything in this section about "the tab"
> describes the API/runner contract that still holds.

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

**`source` says whose words are on the wire, not whether a call was made.**
`campaign.py`'s coercion has two routes back to the template — a payload of the
wrong shape, and one whose variants are all empty — and both hand back the
deterministic pack. Those runs answer `"deterministic"`, which is what
`campaign-run.ts` persists and what `JobsCampaignTab` labels, so a pack the model
contributed nothing to is never painted as AI-generated copy (same honesty rule
`automation.py`'s `_generate` carries). When a provider that PASSED the
availability gate fails mid-flight, the cause is handed back to `campaign_cli`
through an `on_fallback` callback — the shape `reasoning_cli` already uses — and
lands in the usage ledger's `reason` (`emit_deterministic`): a one-line
`"<ExceptionType>: <message>"` for a raise, `unusable_output` for a reply
coercion emptied. A keyless or `--no-llm` run records no reason: that descent is
not a failure and the availability gate already named it.

| Route | Method | Purpose |
|---|---|---|
| `GET /api/jobs/[id]/campaign` | GET | Return the stored pack. |
| `POST /api/jobs/[id]/campaign` | POST | Generate/regenerate (spends a fresh creative pass — no cache, since "Regenerate" must mean new copy). |

Every CTA in a pack links the quick-apply form; the pack ships a markdown
copy-all export. Rendering the video scripts into actual video/avatar assets
is out of scope (kp generates scripts only).

**One pack per (job, language, team).** `campaign_packs`' primary key is
`(job_id, lang, workspace_id)`, so two teams generating for the same shared corpus
role (`workspace_id` NULL — the seeded reference roles every tenant can open the
Campaign tab on) each keep their own pack, and a same-team Regenerate overwrites
only that team's row. `saveCampaignPack` upserts with a **target-less**
`ON CONFLICT DO UPDATE … WHERE campaign_packs.workspace_id = excluded.workspace_id`,
which is valid against both key shapes; it still throws on a zero-change write,
which can now only happen while a table carries the legacy key.

A database created before the widening carries `(job_id, lang)`.
`widenCampaignPacksKey` (`app/_lib/db/core.ts`) rebuilds it at boot, guarded by the
primary key's SHAPE read from `PRAGMA table_info` — not by a missing column, since
`workspace_id` was added long before — so it also re-widens an old-key table a
restored dump brings back, and is a no-op on every later boot. **Rolling the image
back past this change** needs `narrowCampaignPacksKey(db)` first: an older image
upserts with `ON CONFLICT(job_id, lang)`, which SQLite refuses against the widened
key. It restores `(job_id, lang)`, keeping the default workspace's pack per slot
(else the newest) and returning how many packs it dropped — packs are regenerable
output. `app/_lib/db/rollback-drill.test.ts` executes that way back, and
`app/_lib/db/tenant-keys.test.ts` fails any team-scoped table whose primary key or
unique index omits `workspace_id` without a named identity-key reason. Behavioral
coverage: `app/_lib/db/campaign-tenancy.test.ts`.

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

## The job's interview kit (2026-09)

A job can now carry an **interview kit**: the competencies it is hired on, with a coarse
weight, a time budget, the questions asked about each, must-ask flags and a recruiter
FAQ the AI interviewer may answer from. It is the spine of every AI interview for that
job. The routes sit under this job's namespace and gate like its siblings: every write
asks `pipeline:write` first, then `canWriteJobLifecycle`, and an invisible job is a 404,
never a 403.

| Route | What it does |
| --- | --- |
| `GET /api/jobs/[id]/interview-kit` | The latest published version, the latest draft and the version list. |
| `POST /api/jobs/[id]/interview-kit` | Queues the `interview_kit` task that drafts a new version from the posting and the promoted RoleBrief (a model call; 20 per 10 min, pinned in the rate-limit contract). Keyless installs get a deterministic draft from `requirements[]`. |
| `PUT /api/jobs/[id]/interview-kit` | Saves an edited kit as a NEW version (`source: "edited"`). |
| `POST /api/jobs/[id]/interview-kit/publish` | Publishes a version; new interview links for this job are minted from the highest published one. |
| `POST /api/jobs/[id]/interview-kit/rehearse` | Mints a test call on any version of this job's kit, draft or published, with no candidate attached, and answers the `/interview/<token>` URL. It gets the real agenda, brief and director, is metered like `/simulate`, and can never score, approve or write to a pipeline entry. |

Versions are append-only (`interview_kits`), so a regeneration never overwrites an edit
and a link pinned to version N keeps asking what version N asked. A kit holds **no
candidate data** — the erasure scrub is entry-keyed and cannot reach a job-keyed row —
and a shape test keeps that sentence true. The **Kit** tab of the posting modal (`JobsKitTab.tsx`) is where a recruiter drafts one from the posting, edits competencies, weights, budgets, questions, must-asks and the FAQ, publishes a version, and rehearses it before any candidate meets it. How the kit becomes an agenda, a brief and a
director policy is the interview feature's story:
[`docs/features/interviews/README.md`](../interviews/README.md) §"The job interview
kit" and §"The kit in the interview".

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

Identity in that matrix is the **candidate id**, never the display label. Two
candidates can share a name (a common Czech name, or every unnamed profile's
`Candidate` fallback from `transform.build_match_candidate`), and
`fairness_check` used to exclude KO-failed candidates from `ranking` by label, so
an eligible senior whose junior namesake failed the must-haves vanished from the
robust order too. The group eval's alignment guard then counted `ranking` +
`koFailed` short of the field and sealed the evaluation as "robustness could not
be assessed". Now `matching.fairness_matrix` also returns `order` (pool indices),
`fairness_check` excludes by index and emits `rankingIds` (the robust order as
candidate ids, `ranking` staying its index-aligned label twin), and the group-eval
payload carries `recommendedIds` beside `recommendedOrder`. `isFairnessAligned`
validates `rankingIds` as identity when present (known, unique, not KO-failed,
label twin in lockstep), `robustOrderVerdict` compares ids when both sides carry
them (a swapped namesake order now reads as diverging), and the robust-order pills
and this audit table key their rows on the id. Blobs sealed before these fields
existed have no ids and keep the label rule. Pinned by `NamesakePoolTest` in
`test_fairness.py`, `NamesakeFairnessCheckTest` in `test_recruiter.py`,
`fairness-guard.test.ts` and `groupEvalRobustness.test.ts`.

## Rediscovery shows a page, and says when it is one

`rediscoverForJob` slices its ranked silver medalists at `REDISCOVER_LIMIT` (20)
and returns the remainder as `more`; `GET /api/jobs/[id]/rediscover` forwards it.
`JobsRediscoverPanel` dropped that number, so a pool holding 35 qualifying past
candidates rendered its top 20 under an intro that describes the list as "past
candidates who clear the bar for this role" — a cut slice presented as the whole
set, on the surface whose entire promise is that nobody falls through the cracks.
The panel now appends the shared `match.card.moreCount` line ("+15 more") below
the list whenever `more > 0`. A failed on-demand load offers the same retry
control the standing feed already has (`reload` from `useJsonFetch`), so a
spawn timeout is recoverable without closing the modal. Pinned by
`jobsRediscoverRetry.test.ts`. The list also filters client-side by prior kind
(`rejected` / `closed` / `elsewhere`, default all on) so a recruiter can hide
"we rejected them" while looking at "the req died". An empty filter shows its
own empty state, not the pool-empty copy. Pinned by
`jobsRediscoverKindFilter.test.ts`. The **standing** feed (`JobsRediscoveryFeed`) is a
separate, alert-backed surface and is not paged this way.

The same honesty applies one layer up. `buildCandidatePool` already computes
`truncated` when 100 profiles or 60 analyses fill a cap, but `rediscoverForJob`
used to destructure that flag away, so silver-medalist ranking silently omitted
the overflow with only a `console.warn`. `RediscoverResult` now carries
`poolTruncated` (a boolean, never a list of dropped identities — same rule as
`suppressed`) and `GET /api/jobs/[id]/rediscover` forwards it. A capped pool still
returns its ranked subset; the flag says the subset is not the whole corpus.

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

## The Campaign tab left the posting modal (2026-09)

`JobsCampaignTab.tsx`, its logic/types/variant card and `jobsCampaignPackKey.ts`
are deleted; `POSTING_TAB_IDS` is six ids and the footer's pack-on-publish CTA
(and the `packExists` probe under the latest-request guard) went with it. The
generation side is untouched: `POST /api/jobs/[id]/campaign`, `campaign-run.ts`,
`campaign.py`, the `campaign_packs` store and its tests all remain, reachable by
API and by the tasks dock. Bringing a pack back to a screen is a new surface, not
a revert.

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
team's feed — and dismissal is sticky (the `UNIQUE (workspace_id, job_id, candidate_id)` index
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
rows are kept deliberately (the `UNIQUE (workspace_id, job_id, candidate_id)` index is what makes
dismissal sticky) and un-acted-on ones simply accrued, each holding a candidate's
name for a re-contact that never happened. `pruneRediscoveryAlerts` now drops
dismissed rows past `ALERT_DISMISSED_RETENTION_DAYS` (30) and undismissed ones past
`ALERT_STALE_RETENTION_DAYS` (90), from the clock in `instrumentation-node.ts`
beside the apply-session retention sweep and under the same autonomy pause.

**The dedup key is per team.** It used to be `ux_rediscovery_alert ON (job_id,
candidate_id)`; the store's first open now drops it and creates `ux_rediscovery_alert_team` led by `workspace_id`
(the same-name `CREATE … IF NOT EXISTS` would have been a no-op). A cross-team
collision on the old key is not reachable through `buildCandidatePool` — candidate ids
are globally-unique PKs owned by one team — but the key, not the caller, decides what
a second team's write does.

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

## Two desks: Job descriptions is the shelf, Roles is the work (2026-09)

The Library group's two tabs were both "a list of the roles", differently
decorated. They now answer different questions:

- **Job descriptions** (`app/features/library/jds/`) is the shelf of drafts a
  recruiter reuses, *regardless of liveness*. The Status filter defaults to
  **All but live** (`StatusFilter` value `notLive`, `jdsLedgerLogic.ts`) so the
  roles currently open do not sit on the shelf as noise; "All" and the single
  states are one menu away. The **Pipeline column is gone** from this ledger,
  along with its sort accessor and `PipelineShapeBar` cell (`JD_SORT_COLS` is now
  `analyzed | saved`, the table is seven columns, the Role title's width cap grew
  from 13rem to 24rem). The per-role live state that column carried is the Roles
  tab's business. The keyless e2e spec that pinned the column
  (`e2e/jds-pipeline-column.spec.ts`) went with it, and so did its three pins
  (`KEYLESS_SPECS`, `ci.yml`'s release job, the CLAUDE.md list).
- **Roles** (the tab id stays `jobs`; `nav.tabs.jobs` reads Roles / Pozice /
  Stellen / Postes) is the desk of open and historical roles. **Open roles only**
  is on by default (`useJobsList.ts`); an ingest still clears it so the new draft
  can surface (`ingestNeedsOpenFilterCleared`). The role lifecycle itself (target
  hires, auto-close on the last hire, per-language postings) is documented in its
  own section below.
- The intake copy under the Job descriptions title is one sentence now
  (`library.tab.intro`); the "save it as a draft, then source it" sentence was
  the old two-desk story.

`GET /api/jds` still composes `listJobPipelineStats()` into each row
(`JdRow.pipeline`); nothing in the ledger reads it any more, and it is left in
place for the Roles side rather than removed from the wire in the same change.

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
segment rather than a confident "0". The segment deep-links `?tab=assignments&job=<id>`,
so it lands on the Assignments ledger narrowed to this role (a clearable chip above the
table) rather than on the whole library; see [the dev-case doc](../dev-case/README.md).

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

The Compare tab's failed load (`useJsonFetch`) offers the same retry control the
Coach panel already has, bound to `reload` — a transient 500 is recoverable
without closing the modal. Pinned by `jobsCompareInterviewsRetry.test.ts`. The
grid itself exports as CSV (`compareCsvRows` in `jobsCompareCohorts.ts`):
competency × candidate, AI rating, human rating, recommendation; a missing
side is blank, never `0`. Same shape as the Fair Rank audit export.

## The winnability coach stages the number it actually computed

The Coach tab's pattern rows (`coach/CoachLedger.tsx`) can hand a
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
of the spend, answering `jsonRefusal("JOB_NOT_FOUND", 404)` (never `403`, so the
endpoint can't confirm an id exists); seeded corpus rows stay visible to every
tenant. The point-read `GET /api/jobs/[id]`, ingest's too-short paste
(`JOB_AD_TOO_SHORT`), outreach's missing `candidateId` (`OUTREACH_CANDIDATE_REQUIRED`)
and GDPR 409 (`COMMS_SUPPRESSED`, with the existing `suppressed` token) use the
same coded envelope so the Roles desk resolves them via `errors.*` in all four
locales. The candidates empty-pool short-circuit drops the English `note` and
answers `{ candidates: [] }` — clients already key off the empty array. The last two were the
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
`JobsTabResults`, which painted `jobs.tab.showingCut` (amber) whenever the slice was
cut. Since challenge-r07 the desk pages through the whole matching set on the server
(see "The Roles desk window" at the end of this file), so it renders
`jobs.tab.showing` against `matching` and the cut line no longer applies there.

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
- The campaign pack now ships `defaultedFields` (camelCase, the list
  `normalize_job` recorded) beside `warnings`. A job that defaulted location +
  seniority includes those slugs; a fully stated job sends `[]`. Painting the
  list is `campaignDefaultedChips` (`jobsCampaignDefaulted.ts`): known slugs get
  a localized chip, unknown slugs get "assumed {field}", and `[]` paints none.
  The Campaign tab is still gone, so the next pack surface calls that helper.
  Pinned by `test_campaign.py` and `jobsCampaignDefaulted.test.ts`. Also on the
  pack schema floor as `defaultedFields`.
- **The Fair Rank audit table still ranks one number across cohorts it is not
  comparable within.** The producer now labels the split: `recruiter.fairness_check`
  carries index-aligned `tracks` (`experienced` / `early_career`) and a `koFailed`
  id list, and drops KO-failed ids from `rankingIds` / `ranking` (pinned by
  `pipeline/jobfit/tests/test_recruiter.py`). `own` / `mean` stay the full
  validated pool so the CLI lockstep does not shrink. `FairnessAuditPanel` still
  renders a single list sorted by `mean` descending with no track and no
  eligibility column — so an early-career candidate scored on *potential* is
  ranked against an experienced one scored on work history (the interleave the
  Candidates tab promises two paragraphs above it never happens: "never ranked
  on one number against experienced candidates"), and a KO-failed candidate can
  still sit in the audit table even though they are gone from `ranking`. Fixing
  the panel needs it to read `tracks` + `koFailed` (or `koPassed` from the
  ranked rows) and a column label.
- No structurally-tracked, independently-provenanced editable salary band yet
  (would need its own `source: "manual"` marker, not a re-parse of the
  markdown).

## Deleting a job description

The JD Ledger (`app/features/library/jds/`) is the shelf of DESCRIPTIONS regardless
of liveness, and until now it was append-only in one direction: a JD could be
edited, archived and reverted, but never removed. Archive is the right default —
it keeps the row so existing analysis and share links resolve — yet a draft that
should never have existed had no way out. The Actions column now carries a trash
icon beside Open / Duplicate / Ingest.

**Who sees it, and what happens.** Two conditions gate the icon, and BOTH are the
server's own answers rather than client inference:

| Condition | Where it is decided |
| --- | --- |
| The reader created the JD, or holds an owner/admin seat | `canDeleteJd` (`app/_lib/jds-delete-rule.ts`), folded per row into `canDelete` by `GET /api/jds` |
| The linked `jd-<slug>` role is not live | `statusCategory(row) !== "live"` on the client; `isJobOpenForApplications` on the server |

A row failing either test renders nothing — a disabled icon for an action a reader
can never take is noise in a ledger they scan. Confirming opens a themed `Modal`
(never `window.confirm`, which the design tokens cannot reach) and the delete runs
`DELETE /api/jds/[slug]`.

**Authority.** The rule is narrower than any existing capability on purpose.
`pipeline:write` — what the JD edit door asks for — is held by every recruiter, and
a recruiter deleting a colleague's draft is exactly what the rule excludes. So the
door is per-row: `jds.created_by` (a new nullable column, stamped by `saveJd` /
`insertAnalyzingJd`) carries the author, and `app/_lib/jds-delete-access.ts`
resolves the actor. In **open dev** (no `KP_OPERATOR_PASSWORD`) and for an
**operator-password session** there is no user id to stamp or match, and both
already fold to owner everywhere else in the app, so both resolve as admin — the
door works in the setup most operators run. Everything else reads the live
membership role on the session's workspace. A NULL `created_by` (a legacy row) is
"no creator claim" and matches nobody, so only an admin clears those: the
fail-closed direction.

**Blast radius, stated because a delete cannot be re-read.** `deleteJd`
(`app/_lib/db/jobs.ts`, IMMEDIATE) removes the `jds` row and its `jd_revisions`
history, both workspace-scoped. It does NOT touch `analyses` rows keyed on
`jd_slug` — a candidate's analysis is a record of work done on a person, not a
property of the description — and it does NOT touch the linked `jd-<slug>` job,
which is a separate lifecycle object with its own door on the Roles tab.

**Refusals** answer with codes, never prose: `JD_DELETE_FORBIDDEN` (403),
`JD_LIVE_CANNOT_DELETE` (409), `JD_DELETE_FAILED` (500, via `safeJsonError`). The
client resolves each through `useErrorMessage()` in the reader's language.

Known gap: only `POST /api/jds` stamps `created_by` today. The builder's Generate
path (`startJdBuild` accepts a `createdBy`) and `POST /api/jds/save` still pass
nothing, so JDs created there are admin-deletable only until their doors thread
`(await currentUser()).userId` through.

## The role's Candidates tab: one ranked ladder over the pool

The Candidates tab inside the posting modal (`RecruiterCandidates`,
`app/features/library/jobs/JobsRecruiterCandidates.tsx`) is the fair-comparison
lens over the saved pool, scored against this role by
`GET /api/jobs/[id]/candidates`. It used to be two columns of nine-badge cards
(experienced / early-career) that spent a screen on a dozen people and had no way
into the one place a candidate is actually read. It is now a thin **frame** over
ONE layout, the **Ladder** (`app/features/library/jobs/candidates/CandidatesLadder.tsx`):
a dense ranked table on the shared table kit (`ColumnHead` sort, `ColumnFilter` by
name and stage, `TablePager` at 20/page, `TableStatus`), where the KO-filtered rows
sit in the same table as the rest, wearing their reason, and the whole row is the
click target into the candidate modal. It won the 2026-09 prototype round over a
banded "rungs" list and a card grid; both are deleted, along with the layout
switcher and its `localStorage` memory.

**One row model.** The ladder reads `LadderRow[]` built once by
`candidates/candidatesModel.ts` (`buildLadderRows`) — rank, the displayed score
(the robust cross-scheme mean under Fair Rank, the own-weight total otherwise),
band, the capped strength/gap strips, the near-miss flag, and the stage of this
candidate's active entry for this role. The pure half is pinned by
`candidatesModel.test.ts` and the "the ladder carries the KO cohort" contract by
`jobsCandidatesMemo.test.ts`.

**The fairness facts live on the frame**, above the ladder: the
capped-pool note (`poolTruncated`), the early-career shielding sentence, the Pool
Fit and Fair Rank toggles with their consequences, the skipped-candidate note, and
the cross-scheme `FairnessAuditPanel` with its CSV export. Each layout carries the
KO-filtered cohort itself, in the shape that layout can be honest in.

### The modal bridge

A row click opens the candidate modal. The ranked pool and the board speak
different nouns — a row here is a CANDIDATE (a saved profile or CV analysis),
while `CandidateModal` is built around a pipeline ENTRY — so
`candidates/useCandidateBridge.ts` picks one of two doors from the row's own data:

- **`inPipeline != null`** (the route already decorates each row with the stage of
  that candidate's active entry for this job) → the real
  `app/features/hiring/pipeline/candidate/CandidateModal.tsx`, on that entry. The
  entry and the stage `axis` both come from ONE `GET /api/pipeline` read, cached
  per mount, so no route had to change and the modal is the same one the board and
  the decisions ledger mount.
- **`inPipeline == null`** → `candidates/CandidatePreviewModal.tsx`: the honest
  read-only pre-pipeline view (score and confidence, matched skills with their
  provenance, missing skills, assumptions, KO reasons) with the two sourcing
  actions the deleted cards carried. A candidate with no entry has no stage, no
  timeline and no decision to rule on, and opening the entry modal on a synthesized
  entry would invent all three. File them, and the next click opens the full view.

A lookup that finds nothing (the entry closed or moved between the ranking and the
click) falls back to the preview rather than to an empty modal.

The bridge reads `GET /api/pipeline` on EVERY open rather than caching it for the
tab's lifetime: a stage move made on the board while this tab stays open must not
hand the modal a stale entry, and one small GET per click is the cheaper honesty
(the cache and its "invalidate on change" bookkeeping were the 2026-09 known gap).

Known gaps: none recorded.

## The Coach tab is a ledger of patterns, weighed on a three-notch dial

The Coach tab no longer paints a winnability verdict. The grade underneath is the
same one it always ran (`GET /api/jobs/[id]/winnability` → `winnability_cli`, the
production `ko_filter` + `score_job` over the shared capped pool); what changed is
what the recruiter does with it. `coach/rolePatterns.ts` turns the grade into a
**ledger of patterns** — one row per finding the pool shows against this role:

| Kind | Row | `affected` measured against |
| --- | --- | --- |
| `language` / `education` | a hard gate that drops otherwise-eligible people | the whole pool |
| `skill` | a must-have the eligible candidates lack | the **eligible** slice, not the pool |
| `salary` | a band under the market benchmark | nothing countable (see below) |

Two honesty rules are pinned by `coach/rolePatterns.test.ts`. A pattern that costs
nobody is not a row — the ledger is findings, not an inventory of requirements. And
the salary row carries `share: null`, rendered as a dash: the candidates a low band
costs are the ones who never applied, so a `0 of 34` there would read as "this costs
nobody". A silenced salary verdict (`belowMarket === null`, the cross-currency case
with no FX) produces no row at all.

### One layout: the Ledger, fused with the Dial's control

`coach/CoachLedger.tsx` is the surviving layout of the 2026-09 prototype round —
the Ledger as the baseline (the shared table kit: `ColumnHead` sort on pattern /
share / priority, `TablePager` at 20/page, `TableStatus`), simplified to ONE line
per pattern: the headline with its measure inline ("Kubernetes missing · 23 of 34"),
the share bar with its percent, the priority control, and one icon-only action (the
"stage this edit" hand-off into the JD editor, `jobsCoachApply.ts`). The priority
control is the Dial variant's three-notch dial (`coach/CoachPriorityDial.tsx`): one
control with three positions rather than three chips, the active notch painted in
the level's token. The Stack (lanes) and Dial (projected shortlist) layouts, their
switcher, the `projectPool` projection and the lane helpers are deleted; the panel
reads one hook (`coach/useRolePatterns.ts`) and one derivation (`rolePatterns.ts`).

### The priority vocabulary

`critical` · `important` · `minor` (`app/_lib/role-priorities.ts`), weighted **3 / 2 /
1**. The words are about WEIGHT, not requirement kind: the role already carries a
must_have / nice_to_have axis and a second must/nice control beside it would read as
the same field spelled twice. A pattern with **no** entry is untagged, which is a
distinct state from `minor` — "not yet judged" is not "drop it"; clicking the
active notch clears back to it.

### Where the tags persist

`role_pattern_priorities`, a lazy-store table (own connection, `role-priorities-store.ts`)
keyed **(job_id, workspace_id)**, read and written through `GET` / `PUT
/api/jobs/[id]/priorities`. It is its own table rather than a field on the job's
`payload_json` because the jobs corpus is dual-tier: a seeded corpus row carries
`workspace_id NULL` and is shared by every tenant, so a priority written onto that row
would hand one team's private judgement of a role to every other team on the
deployment — and the next team to tag it would overwrite the first. The composite key
keeps a corpus role taggable by everyone with nobody reading anyone else's weighting.
Listed in `TENANCY_SCOPED_TABLES` + `TENANCY_LAZY_TABLES`, proven by
`app/_lib/role-priorities-tenancy.test.ts` with no by-id carve-out.

### The weight seam — what is wired and what is not

**The scorer does not read these weights yet, and the panel says so** (the Coach
footnote states it in all four locales). The tags are persisted and readable
server-side; the remaining seam is exactly two hops:

1. `rankPoolForJob` (`app/_lib/recruiter-run.ts`) writes `{ jobId, candidates }` into
   `recruiter.json`. It would need to read `getRolePriorities(jobId, workspaceId)` and
   add a `priorities` field (and the two callers that matter —
   `app/api/jobs/[id]/candidates/route.ts` and the automation sweep — would need to
   pass the workspace they already resolve).
2. `pipeline/jobfit/recruiter_cli.py` → `score_job` would need to consume it as a
   per-requirement weight. Today the only weight input in the CLI is `--weights-llm`,
   which resolves the `weight_proposal` use case for the **fairness matrix**, not for
   the headline score — so there is no existing weights input to thread into.

Until both land, a weight is a recorded judgement and nothing more; the footnote
says so, and nothing here re-runs the scorer.

Known gaps: the weight seam above. The ledger derives only from the winnability
payload — richer per-candidate patterns (a seniority mismatch, an archetype skew)
would need `GET /api/jobs/[id]/candidates`, which spawns a second CLI per open.

## The role lifecycle: open, filled, closed

The Roles tab is the desk of **open and historical** roles. Its eighth column used to
be `Entry` (a fairness fact about the requirements); it is now `Status`, and the
whole open/close review system hangs off it.

### The vocabulary, and why one of the four is derived

`jobs.status` records what a recruiter DID to a role — wrote it (`draft`), took it
live (`published`), retired it (`closed`); `NULL` is a seeded corpus row, live by
contract (`isJobOpenForApplications`). What the desk shows is a different question —
what the role IS right now — and answering it needs the pipeline's hired count as
well. `roleStatusOf` (`app/features/library/jobs/jobsRoleStatus.ts`, pinned by
`jobsRoleStatus.test.ts`) derives four values from the two facts:

| Status | Means | Tone (`ROLE_STATUS_TONE`) |
| --- | --- | --- |
| `draft` | never taken live, whatever its hired count says | neutral |
| `open` | live and still short of its target; the cell also shows `hired / target` | active |
| `filled` | hired count reached the target, retired or not yet | done |
| `closed` | retired short of its target (a manual close, an abandoned req) | stopped |

**`filled` is deliberately not a stored status.** The auto-close hook runs *after*
the hire commits, so a role sits at 3-of-3 and still `published` for a moment; a
stored flag would contradict the count beside it, and no migration could ever leave
the two disagreeing. Sorting the column uses the desk's reading order (open → draft →
filled → closed), not the alphabet, which is not the same in any of the four locales.

The Status filter is a **server** predicate (it ran client-side over the truncated
page until challenge-r07, so a filled role ranked past the cut never showed): the
store derives the status in SQL (`ROLE_STATUS_SQL` in `db/jobs.ts`) from the overlay
status, the folded target and a `pipeline_entries` count on the workspace's own
terminal-ROLE stages, and `jobs-browse.test.ts` pins it against `roleStatusOf` on
every cell of status x hired x target, so badge, filter and sort cannot disagree. A
`?job=` deep link or a just-ingested draft that is not on the current 20-row window
is point-fetched by id (`GET /api/jobs/[id]`), never reported missing.

### Opening a role

Publishing asks for its terms first (`JobsPublishDialog`, opened from both the posting
modal's footer and the Drafts panel's row button — one dialog, because it is one act
through one route):

- **target hires**, 1..50, default 1. `POST /api/jobs/[id]/publish` accepts
  `{ targetHires?, langs? }`; an out-of-range or non-integer value is refused with
  `JOB_TARGET_HIRES_INVALID` before the billing gate, so a malformed target can never
  leave a role live under a 400.
- **languages** the role is advertised in, defaulting to the app locale.

Both persist in the **same transaction** as the status flip (`setRoleOpenConfig`
beside `setJobStatus`), so a role is never live under a target the auto-close hook has
not seen. Two new `jobs` columns carry them: `target_hires INTEGER` (NULL = 1, folded
by `roleTargetHires` rather than backfilled) and `posting_langs TEXT` (a JSON array).
Both are `COALESCE`d on write, so a reopen that restates nothing keeps the terms the
role was opened with — a 3-hire req does not silently reset to 1.

An empty body still works: that is what the one-click go-live posts, and it means
"do not change the terms".

### Auto-close, and why two simultaneous hires cannot double-close it

`app/_lib/stage-hooks-role-fill.ts` is a post-commit arrival hook, scheduled from
`scheduleStageEnteredHook` through `afterResponse` like the interview and homework
hooks — never inside the move's transaction, because better-sqlite3 transactions are
synchronous and the reconciliation is not. It asks the board's **terminal role** (not
a column literally named "Hired"), re-reads the entry to catch a move that landed in
the gap, and compares `listJobPipelineStats(ws)[jobId].hired` — the same rollup the
desk shows — against the role's target.

The flip itself is a **compare-and-swap**: `closeRoleIfOpen` (`app/_lib/db/jobs.ts`)
is a single `UPDATE … WHERE id = ? AND (status IS NULL OR status = 'published')` and
returns whether it changed a row. Two candidates dropped onto the terminal column at
the same moment produce two hooks that both read "3 of 3"; only the one whose UPDATE
won goes on to `closeEntriesByJobId`, so a filled role runs exactly one withdrawal
sweep and the loser stops silently. A manual close racing the hook is safe in the same
way, in either order. The withdrawal writes the ordinary `role_closed` events, so a
candidate's timeline cannot tell an auto-close from a manual one — which is correct,
because to them it is the same event.

Best-effort throughout: the hire stands whatever happens here, and a withdrawal that
throws after the close committed is logged, not surfaced as a failed hire.

### Translations of the posting

Opening a role in more than one language orders a **translation per language**. They
are rendered post-commit and **in parallel** (`runPostingTranslations`, `Promise.all`
over the languages that are not the source), through `afterResponse` so the publish
response never waits on them.

- Source of truth for the source document: `renderPostingMarkdown` runs the SAME
  client-side renderer the modal shows (`jobToMarkdown` + a locale-pinned catalog), so
  a translation is never a translation of a document the recruiter never saw.
- The model call is the new `posting_translate` use case
  (`pipeline/jobfit/posting_translate_cli.py`; registered in
  `USE_CASE_REQUIREMENTS`/`USE_CASE_MAX_TOKENS`, `LLM_USE_CASES`, `ROUTING_SECTIONS`
  and `.ai/use-cases.json`). Prose in, prose out, no JSON capability required.
- Storage is `job_translations`, keyed `(workspace_id, job_id, lang)` so
  re-generating a language REPLACES its body. Workspace-scoped with **no** shared tier
  and no by-id carve-out even when the role itself is a shared corpus row: the body
  was generated on one team's order and against one team's spend
  (`app/_lib/db/job-translations-tenancy.test.ts`).
- `GET /api/jobs/[id]/translations` lists what exists plus the role's languages and
  its source language; `POST` with `{ lang }` generates one on demand, rate-limited
  20/10min per IP as `jobs-translate:` (pinned in `app/api/rate-limit-contract.test.ts`).

**Keyless behaviour — the one place in this app where keyless means NO output.** Every
other LLM surface here has a deterministic twin; a translation cannot have one,
because only a model can turn Czech prose into German prose. So with no provider
configured the CLI exits 0 with `source: "deterministic"` and a reason, **nothing is
persisted**, and the posting tab keeps its dashed empty state with a "Generate
translation" button. The on-demand door answers `JOB_TRANSLATION_UNAVAILABLE` (503),
which the client resolves through `errors.*` in the reader's own language — it never
renders the server's string. A stub presented as a German advertisement would be far
worse than none: the posting is the document a candidate applies against, so the
system prompt also forbids adding, dropping or altering any requirement or figure.

In the posting tab the source language keeps the client-built markdown (always
present, always current); any other language renders the stored body, or the empty
state. The tab panel carries a `min-h-[32rem]` floor so switching tabs does not resize
the dialog under the reader's cursor.

A re-ingest of the role under its existing id (an edited JD saved through
`PATCH /api/jds/[slug]`, a restored revision, the library's ingest door) rewrites the
role's fields, so `insertJob` (`app/_lib/job-ingest.ts`) drops that team's
`job_translations` for the role on the same connection — a German advertisement of
the previous text is not a translation of this one. The posting tab shows the empty
state again and regrows each language on demand. Pinned by
`app/_lib/db/job-translations-tenancy.test.ts` (one team's drop never touches the
other team's rows).

**The public JD page serves the stored translations.** `/jds/<slug>?lang=<l>` is the
link a recruiter shares on a board in that language, and it now serves the posting
translation for `<l>` WHOLE (its title and body) when the owning team holds one made
after the JD's last edit (`jdLastEditedAt`, so a JD edit whose best-effort re-ingest
failed and left the old renderings in place stops serving them). Every other request
(no `?lang=`, the source language, a language never rendered, an archived JD) serves
the whole original, byte-identical to before. Translations are read with the OWNER
team `loadPublicJd` resolved, never the viewer's, and the page only ever sees the
projection `{lang, sourceLang, title, bodyMd}`. A translated variant renders a
machine-translation note naming the source language (`Intl.DisplayNames`, in the
reader's locale) with a link to the original, the copy-as-Markdown button copies the
body actually served, and the operator's Edit/Archive/History tools mount only on the
original. Keyless installs never store a translation, so they serve and advertise the
source language only. Resolver and alternates: `app/jds/[slug]/jdPublicVariant.ts` and
`publicJdAlternates` in `jdPublicHeader.ts`, pinned by `jdPublicVariant.test.ts`. The
translation is of the rendered POSTING (`renderPostingMarkdown`), not of the JD's own
markdown, so its structure can differ from the original's; the note says it is a
translation and links the authoritative original.

Known gaps: there is no bulk "translate every open role" action, and the auto-close hook does not notify
anyone that a role retired itself (it writes no event kind of its own by design; the
withdrawn candidates' `role_closed` events are the only trace).

## The Roles desk window: sort, status and paging are the server's

Until challenge-r07 (`jobs-table-core/A`) the Roles desk split its query axes across
two tiers: `GET /api/jobs` cut a 300-row page ordered by entry eligibility, and the
client then sorted that slice by title, filtered it by derived status and windowed it
to 20 rows. A workspace past 300 matching roles could not reach whole roles from the
table, whatever the reader clicked. Every axis now runs where every row is visible.

| Surface | Contract |
|---|---|
| `JobFilter` (`db/jobs.ts`) | Optional `sort` (`JOB_BROWSE_SORTS`: title, location, mode, seniority, family, salary, status), `dir`, `offset`, `roleStatus` (open/draft/filled/closed), `withHired`. All absent = today's entry-eligible ORDER BY and SQL, byte-identical rows (the JD library, analytics and benchmark callers). |
| `listJobsPage` / `countJobs` | ORDER BY an allowlisted key with missing values last in both directions and `jobs.id` as the tiebreak; `LIMIT/OFFSET`; the hired subquery (terminal-ROLE stage ids from the workspace's axis, bound) joins only when status, a status sort or `withHired` needs it. `countJobs` binds the identical predicate. |
| `GET /api/jobs` | Reads `sort`, `dir`, `offset`, `roleStatus` through allowlists (unknown value -> default, never SQL); malformed or negative `offset` -> 0; a windowed read with no `limit` answers 20 rows; the answer adds `window: {sort, dir, offset, roleStatus}` echoing what was APPLIED. `hired` on each row now comes from the store's query. |
| `useJobsList` | `jobsListQuery` emits `sort/dir/offset/roleStatus`; `sort` + `toggleSort` state; no client-side filter. |

Declared differences from the old client sort:

- **Salary** orders by the `salary_min` column (ingest writes `salaryBand[0]` there),
  not the payload band floor; a corpus row whose column and payload disagree now
  sorts by the column.
- **Text** keys go through `kp_fold` (NFD, combining marks stripped, lower-cased), a
  deterministic function registered on the connection, because SQLite has no ICU
  collation. Known deviation from the client's `Intl.Collator`: Czech sorts "ch" after
  "h" and c/r/s/z with caron as their own letters; `kp_fold` sorts them as the base
  letter.
- The amber `showingCut` line no longer renders on this desk: a multi-page answer is
  paged, not cut. The key stays in the catalogs.

Tests: `app/_lib/db/jobs-browse.test.ts` (320-role fixture, the status matrix with a
per-team overlay, a renamed terminal stage, ordering), `app/api/jobs/jobs-list-window.test.ts`
(params, fallbacks, echo), `useJobsList.test.ts`, `jobsTabDeepLink.test.ts` and
`jobsIngestLatch.test.ts` (wire mapping, the latch's point-fetch).

## Silver-medalist alerts are a reconciled projection behind one eligibility gate

Until challenge-r08 (`candidate-rediscovery/A`) "may this person be surfaced for a role
they never applied to?" had three answers. The rank gate in `rediscoverForJob` composed
consent + opt-out inline, the alert write wall in `recordRediscoveryAlerts` checked
consent only (an opted-out person's name was persisted), and the feed read in
`/api/rediscovery/alerts` checked neither, so a person who opted out or was erased
AFTER their alert was written kept a row with an *Add to pipeline* button (erasure only
masks the label) until the 90-day prune. Alert rows were also write-once: `INSERT OR
IGNORE` froze the first sweep's score, and nothing retracted a row whose candidate
stopped qualifying.

**One gate.** `withheldCandidateIds(ids)` (canonical import site
`app/_lib/rediscovery-eligibility.ts`, defined beside its consent half in
`rediscovery-alert-store.ts` so the store and the gate do not import each other) returns
`Map<id, "anonymized" | "opted_out" | "consent_expired">`, in that precedence. Both halves
stay workspace-global and fail closed. Every door reads it:

| Door | Where |
|---|---|
| Rank | `rediscoverForJob` filters the pool before `recruiter_cli` (the panel's `GET /api/jobs/[id]/rediscover` and every raise) |
| Write | `recordRediscoveryAlerts` and `reconcileRediscoveryAlerts` (the second wall) |
| Read | `liveRediscoveryAlerts(ws)` (`rediscover.ts`): relevance (role published, candidate has no entry in it) plus the gate. It is the only read behind `GET`/`POST /api/rediscovery/alerts`, so the feed rows and their `count` agree |
| Act | `POST /api/jobs/[id]/candidates/outreach` (Reach out) refuses `COMMS_SUPPRESSED` 409 before minting an entry; an opt-out still answers `suppressed: "candidate"` |
| Add | `POST /api/pipeline` with `source: "rediscovery"` (the feed's *Add*) or `"sourcing"` (the Rediscover and recruiter panels) refuses `PIPELINE_ADD_CANDIDATE_WITHHELD` 409 + `withheld: <reason>` before the write |

**Reconcile.** `raiseRediscoveryAlertsForJob` (publish + Refresh sweep) calls
`reconcileRediscoveryAlerts(jobId, title, qualifying, evaluated, ws)` in one IMMEDIATE
transaction with the gate read before it: new qualifiers are inserted (`raised` counts
only these), a live row's score/prior/label are refreshed, and an undismissed row is
deleted when its candidate was `evaluated` and no longer qualifies, or is now withheld.
`evaluated` is internal to `RediscoverResult` (never on a wire) and excludes everyone the
ranker gave no verdict on: unscored rows, the ranker's own `skipped`, and qualifiers past
`REDISCOVER_LIMIT`. A failed ranking reconciles nothing. Dismissed rows are never
touched, so dismissal stays sticky. `RaiseOutcome.retracted` reports the deletions.
Every statement is workspace-scoped (`rediscovery-tenancy.test.ts` counts 8).

**The board add gates only a re-surface.** `POST /api/pipeline` reads the gate when the
add carries a re-surface marker (`rediscovery` / `sourcing`, the same set that stamps the
prior link). A human add with no marker (a manual board add, a Match add, a person who
re-applied) is not refused: an opt-out stops outreach and does not withdraw a person from
a process (see the opt-out section of [the comms doc](../comms/README.md)), and the
channel gate (`commsSendSuppression`) still refuses to contact the fresh entry because it
resolves opt-out and consent at the person. Erasure is refused for every caller inside
`createPipelineEntry`. Pinned by `app/api/pipeline/add-eligibility.test.ts`.

Tests: `app/_lib/rediscovery-eligibility.test.ts` (reasons, precedence, the four-door
source guard), `app/_lib/rediscovery-alert-reconcile.test.ts` (write wall, read refilter
after an opt-out and after an erasure, retract / keep / refresh / insert, tenancy),
`rediscovery-consent-rank.test.ts` (the rank gate precedes the spawn).

## The silver-medalist feed is one row per person

Until challenge-r08 (`candidate-rediscovery/B`) the standing feed
(`JobsRediscoveryFeed`) rendered one row per alert, i.e. per person x role
(`rediscovery_alerts` is unique on workspace, job, candidate), in `created_at` order,
while its `added` / `pending` / `rowError` state was keyed by person. Adding a silver
medalist to role Y painted *Added* on her row for role Z and refused to file her there
until a reload.

The wire is unchanged: `GET`/`POST /api/rediscovery/alerts` still return the flat
`Alert[]`, and the reversible dismiss (`jobsRediscoveryDismiss.ts`) still works per row.
The feed derives the person view in the browser from
`app/features/library/jobs/jobsRediscoveryFeedGroups.ts` (pure, no React):

| Function | Does |
|---|---|
| `groupAlertsByPerson(alerts)` | One group per `candidateId`. Her roles and the groups are ordered by `byPriorAwareRank` (`app/_lib/rediscovery-rank.ts`, the panel's comparator) on `{ score, boost: prior.depth }`; a legacy row with a null depth ranks as 0 |
| `markPair` / `pairStatus` | Outcomes keyed by the (person, role) pair: `open`, `pending`, `added`, `reached`, `withheld`, `error` |
| `markPerson` | Withholds every role of one person. Used only for person facts: a reach-out answered `suppressed_anonymized`, and an Add refused `PIPELINE_ADD_CANDIDATE_WITHHELD` (the eligibility gate is person-level). A reach-out `suppressed` verdict can be a stopped sequence on one entry, so it stays on its pair |
| `groupView(group, outcomes)` | `next` (the best role still offered), `rest`, `done`, `withheld` |

The row (`JobsRediscoveryFeedRow`) leads with her best still-open role and its why-now
line (the same `jobs.rediscover.whyNow.*` keys), lists the other roles she clears
under *Also clears* with their scores, and offers **Reach out / Add / Dismiss per role**.
Reach out calls `postReachOut` (the same door and verdict classifier as the Rediscover
panel, source `rediscovery`); refusals render from `pipeline.reachOut.*` and error codes
through `useErrorMessage`, never the server string. A done pair keeps its badge for
`ADDED_BADGE_MS`, then only that pair's alert is dismissed; her other roles stay on the
row. The header count is people, not alerts. A withheld role shows *Can't be contacted*
and offers nothing.

Tests: `jobsRediscoveryFeedGroups.test.ts` (grouping, the band, pair keying, next role,
person-level refusals, dismiss / restore regrouping, legacy depth).
