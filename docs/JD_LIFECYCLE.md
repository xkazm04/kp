# JD lifecycle & the two meanings of "Publish"

A job description (JD) moves through a small set of stages. The word **"Publish"**
historically meant two *different* things in the UI, which confused both users and
new developers. This note pins down each stage and the vocabulary we now use.

## Lifecycle stages

| Stage | What it means | Where it happens | Internal marker |
| --- | --- | --- | --- |
| **Generated** | AI has drafted a JD (RoleSpec + market salary + markdown) but nothing is saved yet. | `JdBuilder` → `JdBuilderResult` (in-memory result). | — |
| **Draft** | The JD is saved and reusable for analysis/matching, but **no candidates have been sourced** and it is not yet live. | `POST /api/jds/save` (AI builder) or `POST /api/jds` (manual paste). Listed under *Drafts awaiting sourcing* in the Jobs tab. | `jobs.status = 'draft'` |
| **Live (sourced)** | The JD is live in the workspace and matching candidates have been **sourced into the Pipeline** (they land at the `Accepted` stage). | "Source into Pipeline" button in `JdBuilderResult` / the Jobs-tab draft row. | `jobs.status = 'published'` |
| **Published to job boards** | *(Not yet shipped.)* The JD is distributed to **external** job boards so applicants can find it. | Disabled "Publish to job boards" button on the public `/jds/[slug]` page. | — |

## The salary band is AI-fixed, not editable

When a JD is **Generated**, the market-salary analysis produces a band that carries
its own provenance (`web-grounded` vs `estimated`), a confidence level, and cited
source URLs. That band is the **single source of truth** the Pipeline matches
against: `ingestStructuredJob` (`app/api/jds/save/ingest-job.ts`) sets
`job.salaryBand` from the analysis's `salary`, normalizing a backwards/degenerate
range rather than dropping it.

The band is intentionally **read-only** in the builder (`JdBuilderResult.tsx`):

- A hand-typed override couldn't honestly wear the "web-grounded · high confidence ·
  [sources]" label, so we don't let one masquerade as researched market data.
- The **Edit** tab edits the JD **markdown** (wording, requirements) only. Editing
  the salary *line* in the markdown changes the **published wording** of the JD —
  it does **not** change the matchable band. The salary card states this explicitly
  so the copy never promises an edit the save path would silently discard.

If a genuinely editable, structurally-tracked band is ever needed, it must come with
its own provenance (`source: "manual"`, no borrowed confidence/sources) — not by
re-parsing the markdown.

## Templates are a live reformat — a switch warns before discarding edits

The **Template** selector in `JdBuilder` is both a *pre-generation* choice (the AI
fills whichever format is chosen) **and** a *post-generation* live reformat: picking a
different template re-renders the AI's structured output (`RoleSpec` + salary) through
the new company format. Mechanically this happens because `JdBuilderResult` is mounted
with `key={templateId}` — changing the template remounts it, so its editable body is
re-derived from the freshly rendered `displayResult.markdown`.

That remount **replaces the editable body**. When the body is untouched this is exactly
what you want (see your need in a different format). But the **Edit** tab holds the only
copy of any hand-edited wording, so a silent reformat would discard those edits with no
prompt. The contract:

- **Untouched body → switch reformats immediately.** No friction for the common case.
- **Hand-edited body → switch is confirmed first.** `JdBuilderResult` reports whether
  its body was edited (`onEditedChange` → `resultDirty`). A switch is then *staged*
  (`pendingTemplateId`) and an inline **"Replace edits / Keep editing"** prompt gates it
  — mirroring the delete-confirm idiom in `JdTemplateManager`. *Keep editing* preserves
  the text and the current template; *Replace edits* applies the new template and
  rebuilds the body from the AI draft.

So templates are a **live reformat**, not a destructive surprise: the body is only ever
replaced on an explicit, informed choice. Edits live only in memory until **Save as
draft** persists them; switching templates is the one action that can replace them, and
it now always asks.

## Save vs. ingest — a draft can exist without a matchable Job

`POST /api/jds/save` does **two** things, and only the first is authoritative:

1. **Save the JD draft** (`saveJd`) — the markdown/title row in `jds`. If this fails,
   the whole request errors (4xx/5xx) and nothing is saved.
2. **Ingest the role as a structured `jd-<slug>` Job** (`ingestStructuredJob`,
   `app/api/jds/save/ingest-job.ts`) — **best-effort**. It is wrapped in a try/catch
   and never blocks the JD save. The response field **`jobIngested`** reports whether
   it ran.

This is a hidden **temporal coupling**: "Source into Pipeline" (`POST
/api/jobs/[id]/publish`) looks up the job by `getJob('jd-<slug>')`. If ingest failed
(`jobIngested: false`), that row was **never created**, so a Publish click would
dead-end with a confusing *"Job not found."* (404) — even though the draft looks
saved.

The contract the builder enforces (`JdBuilderResult.tsx`):

- It reads `jobIngested` from the save response.
- **`true`** → "Source into Pipeline" is enabled (normal path).
- **`false`** → the draft is saved (and still reusable for analysis), but the button
  is **disabled** with an explanation, and an inline **Retry** is offered. The retry
  re-POSTs to `/api/jds/save` **with the existing `slug`**, which re-runs *only* the
  ingest in place (no duplicate draft). On success `jobIngested` flips to `true` and
  the button unblocks.

When `slug` is supplied, the save route rejects an unknown slug (404) so a retry can
never mint a `jd-<slug>` Job with no backing draft.

## The two meanings of "Publish" — disambiguated

The overloaded term split into two distinct, accurate labels:

1. **Source into Pipeline** *(internal go-live)* — marks a saved draft live **and**
   sources matching candidates into the Pipeline. This is the working action behind
   `POST /api/jobs/[id]/publish`.
   - UI label: **"Source into Pipeline"** (`JdBuilderResult.tsx`, `JobsTab.tsx`).
   - It is idempotent — re-running does not re-source.

2. **Publish to job boards** *(external distribution)* — distributes the JD to
   outside job boards. This is **not yet implemented**; the button on `/jds/[slug]`
   is disabled and labelled "coming soon".

> **Why "Publish" still appears internally.** The API route is `/api/jobs/[id]/publish`
> and the DB column it flips is `jobs.status = 'published'`. Those identifiers are a
> stable contract (the matching engine, the simulation harness's
> `data-sim-click="publish"` hook, and `listJobStatuses` all depend on them), so they
> were intentionally **left unchanged**. Only the **user-facing labels** were renamed.
> When reading code, treat the internal `published` status as the **"Live (sourced)"**
> stage above — *not* as external job-board publishing.

## Quick reference for new code

- Need to take a draft live + pull in candidates? Call `POST /api/jobs/[id]/publish`
  and label the trigger **"Source into Pipeline"**.
- Building external distribution to job boards? That is the future
  **"Publish to job boards"** feature — keep it clearly separate from sourcing.
