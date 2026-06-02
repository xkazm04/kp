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
