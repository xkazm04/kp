# Job & JD Management

Job descriptions move from an AI draft to a live, matchable role. This covers
the JD builder/lifecycle, structured job ingestion, the campaign-pack
generator, and the specificity linter that runs live in the builder.

## Entry points

- `?tab=jobs` — the Jobs tab (drafts vs. published/closed, publish action).
- `app/features/library/jds/**` (`JdsBuilder.tsx` — exported as `JdBuilder` — via `JdsGeneratePanel.tsx`, plus `JdsTab.tsx` / `useJdEditor.ts`) — the AI JD builder (generate → edit → save).
- `/jds/[slug]` — the public JD page (candidate-facing).

## Lifecycle stages

| Stage | What it means | Where it happens | Internal marker |
| --- | --- | --- | --- |
| **Generated** | AI has drafted a JD (RoleSpec + market salary + markdown) but nothing is saved. | `JdBuilder` → `JdBuilderResult` (in-memory). | — |
| **Draft** | The JD is saved and reusable for analysis/matching, but no candidates are sourced and it is not live. | `POST /api/jds/save` (AI builder) or `POST /api/jds` (manual paste). | `jobs.status = 'draft'` |
| **Live (sourced)** | The JD is live and matching candidates have been sourced into the Pipeline (they land at `Accepted`). | "Source into Pipeline" button (`POST /api/jobs/[id]/publish`). | `jobs.status = 'published'` |
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

## Save vs. ingest — a draft can exist without a matchable Job

`POST /api/jds/save` does two things, and only the first is authoritative:

1. **Save the JD draft** (`saveJd`) — the markdown/title row in `jds`. If this
   fails, the whole request errors and nothing is saved.
2. **Ingest the role as a structured `jd-<slug>` Job**
   (`ingestStructuredJob`, `app/api/jds/save/ingest-job.ts`) — best-effort,
   wrapped in try/catch, never blocks the JD save. The response field
   `jobIngested` reports whether it ran.

"Source into Pipeline" (`POST /api/jobs/[id]/publish`) looks up the job by
`getJob('jd-<slug>')`. If ingest failed, that row was never created, so a
Publish click would 404. The builder reads `jobIngested`: `false` disables
"Source into Pipeline" with an inline **Retry** that re-POSTs to
`/api/jds/save` with the existing `slug` to re-run only the ingest (no
duplicate draft). When `slug` is supplied, the save route rejects an unknown
slug (404) so a retry can never mint a `jd-<slug>` Job with no backing draft.

## The two meanings of "Publish" — disambiguated

1. **Source into Pipeline** *(internal go-live)* — marks a saved draft live
   and sources matching candidates into the Pipeline
   (`POST /api/jobs/[id]/publish`). Idempotent — re-running does not
   re-source. UI label: "Source into Pipeline."
2. **Publish to job boards** *(external distribution)* — not yet
   implemented; the button on `/jds/[slug]` is disabled ("coming soon").

> The API route (`/api/jobs/[id]/publish`) and the `jobs.status = 'published'`
> column are a stable internal contract (matching engine, the simulation
> harness's `data-sim-click="publish"` hook, `listJobStatuses`) and were
> deliberately left unchanged — only the user-facing labels were renamed.
> Read `published` as **"Live (sourced)"**, never as external job-board
> publishing.

## JD specificity lint (Erika gap E7)

`app/_lib/jd-lint.ts` is a pure, LLM-free rules module that runs live on every
edit in the builder: EN+CS boilerplate phrases ("competitive salary", "dynamic
environment", with inflection-tolerant Czech stems), missing concretes (no pay
figure, no place of work — a work-mode keyword counts as place; a structured
market band suppresses the salary finding), exclusionary/gendered-coded
language, and an over-long must-have list. Findings render in a panel in
`JdBuilderResult` with an explicit all-clear state. Pinned by `jd-lint.test.ts`.

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

## Surface

| Module / route | Purpose |
|---|---|
| `app/_lib/job-ingest.ts` | `setJobStatus`, `getJobStatus`, `isJobOpenForApplications`, draft/published/closed lifecycle. |
| `app/api/jds/route.ts`, `app/api/jds/save/route.ts` | Manual paste / AI-builder save + best-effort ingest. |
| `app/api/jds/save/ingest-job.ts` | `ingestStructuredJob` — JD → structured `jobs` row. |
| `app/api/jds/[slug]/**` | Analyses, retry-analysis, revisions, per-slug JD read. |
| `app/api/jobs/route.ts`, `app/api/jobs/[id]/route.ts` | Job listing / read. |
| `app/api/jobs/[id]/publish/route.ts` | Draft → published + source into Pipeline. |
| `app/api/jobs/[id]/close/route.ts` | Published/draft → closed + withdraw in-flight entries. |
| `app/api/jobs/[id]/campaign/route.ts` | Sourcing campaign pack (E1). |
| `app/api/jobs/[id]/rediscover`, `app/api/jobs/[id]/candidates`, `app/api/jobs/[id]/winnability` | Re-surface past candidates, candidate list, winnability signal. |
| `app/api/jobs/ingest/route.ts`, `app/api/jobs/status/route.ts` | Bulk ingest / status listing. |
| `app/_lib/jd-lint.ts` | Live specificity linter (E7). |
| `pipeline/jobfit/campaign.py`, `campaign_cli.py` | Campaign pack generation engine (E1). |
| `app/features/library/jobs/**` (`JobsDraftsPanel.tsx`, `JobsPostingModal.tsx` / `jobsPostingModalLogic.ts`) | Jobs tab UI: drafts list, publish/close actions, campaign tab. |

## Data model

`jobs` (structured, matchable — `status`, `salary_min/max`, `payload_json`),
`jds` (JD markdown/title prose, separate from `jobs` by design), `campaign_packs`
(one row per job × language).

## Known gaps

- External "Publish to job boards" distribution is not implemented.
- No structurally-tracked, independently-provenanced editable salary band yet
  (would need its own `source: "manual"` marker, not a re-parse of the
  markdown).
