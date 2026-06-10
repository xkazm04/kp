# Fixes — Wave 8: Lifecycle CRUD (2026-06-10)

> Theme H from INDEX.md — the create/update/close verbs the catalog never had.
> 6 findings: JOB1, JDL2, JDL3, JDL1, JOB2, APP1. All implemented.
> Gates per fix: catalogs JSON-valid, tsc 0, unit 646, lint clean on changed files.
> Wave verification: full `npm run build` PASS, `npm run test:python` 500 OK (4 skipped).

One mental model for the wave: **every record the recruiter creates needs its full
verb set — and every gate or state those verbs produce must be enforced at ONE
authority that all surfaces share.** Roles needed *close*, JDs needed *edit /
archive / become-a-job*, rankings needed to *read* persisted state instead of
session memory, and re-applications needed to *update* instead of bounce.

---

## 1. JOB1 — Terminal role lifecycle: close a filled role (`e75f7b6`)

**Where**: `app/_lib/job-ingest.ts`, `app/api/jobs/[id]/close/route.ts` (new),
`app/apply/[id]/page.tsx`, `app/api/apply/[id]/route.ts`,
`app/features/sub_jobs/JobPostingModal.tsx`, `app/jds/[slug]/page.tsx`

Roles could be created and published but never closed — every apply link worked
forever, drafts included (the API accepted submissions for any existing job).
Added `"closed"` to the status union and **one gate authority**,
`isJobOpenForApplications()`, consumed by all three surfaces: the apply page
(closed → localized "role closed" card; draft → notFound), the apply POST
(410 — page-level-only gating is the documented anti-pattern), and the public
JD page's CTA. `/api/jobs/[id]/close` mirrors `/publish` (idempotent POST);
the posting modal gets a confirm-gated "Close role" button. en+cs keys.

## 2. JDL2 — Apply CTA on the public JD page (`b8f1cd7`)

**Where**: `app/jds/[slug]/page.tsx`

The public JD page (the candidate-facing artifact recruiters share) had no
bridge to the apply flow even when a linked job existed and was open. Now:
`linkedJob !== null && isJobOpenForApplications(...)` → "Apply for this role"
linking `/apply/jd-<slug>`; otherwise a recruiter-facing hint. Reuses the JOB1
gate — the CTA can never disagree with what the apply page would say.

## 3. JDL3 — Ingest-as-job from the library (`62d3f64`)

**Where**: `app/api/jds/[slug]/ingest-job/route.ts` (new), `app/api/jds/route.ts`,
`app/features/sub_library/LibraryTab.tsx`

A pasted/imported JD saved to the library was a dead end — only the JD *builder*
path produced a matchable job. The library list now decorates rows with
`jobStatus` (one `listJobStatuses()` call, no N+1) and shows "Ingest as job" on
unlinked rows (POST runs `ingestJobAd(jd.body, "jd-"+slug)`, short-circuits
`{already:true}`), or a status chip on linked ones. en+cs keys.

## 4. JDL1 — JD edit + archive (`f41fd6e`)

**Where**: `app/_lib/db.ts` (migration + `updateJd`/`setJdArchived`),
`app/api/jds/[slug]/route.ts`, `app/jds/[slug]/JdActions.tsx` (new)

The JD library was append-only: a typo or a stale salary band meant delete and
re-create, severing the slug (and with it the public URL and any linked job).
PATCH now accepts `{title, body}` (validated) or `{archived}` (idempotent
`archived_at` migration; `listJds` hides archived). Editing the body of a
JD with a linked job best-effort re-runs ingest — the upsert preserves
lifecycle status, so editing a closed role's text never reopens it. The public
page mounts client `JdActions` (edit form + archive toggle) and shows an
archived banner. English-only (report-adjacent surface, consistent with the
Dev tab pending RES2's i18n wave).

## 5. JOB2 — Persist sourcing state on the ranking (`d6229d6`)

**Where**: `app/_lib/db.ts` (`entryIdsWithEvent` — chunked IN query),
`app/api/jobs/[id]/candidates/route.ts`, `app/features/sub_jobs/JobsTypes.ts`,
`app/features/sub_jobs/RecruiterCandidates.tsx`

"Reach out" / "+ pipeline" state lived only in the hooks' in-memory Sets —
reopen the role tomorrow and every candidate showed fresh, active buttons,
including ones already filed or already contacted. The durable truth always
existed server-side (entries keyed jobId+candidateId; the `outreach_sent`
event); the ranking route now decorates each row with
`{inPipeline: stage|null, outreachSent}`, and the card renders persisted state
(stage chip via `enumLabel`, "reached" state unioned with the optimistic
in-session set). en+cs keys.

## 6. APP1 — Re-apply merges instead of discarding (`fc3f528`)

**Where**: `app/_lib/db.ts` (`findApplicationByApplicant` fallback +
`mergeReapplication`), `app/api/apply/[id]/route.ts`

A detected repeat recorded a bare `re_applied` event and discarded every fresh
answer — the candidate re-applying to add a skipped CV or supply an email
stayed exactly as thin/unreachable as before. Worse, the upgrade path
*duplicated*: a no-email first application is name-keyed; a re-apply WITH email
was looked up by email only, missed, and minted a second row. Now:

- **Upgrade-path lookup**: when the email lookup misses, fall back to a name
  match restricted to CONTACTLESS rows — same person becoming reachable, never
  a row holding a different address (the two-people-one-name doctrine intact).
- **`mergeReapplication`**: SQL-guarded fill-only contact backfill (same
  discipline as `setEntryMatchScore`) + candidate re-point clearing the
  intake-degraded flag. Records no event — the caller logs ONE `re_applied`
  whose detail lists what merged.
- **In-place profile rebuild**: `buildApplicantProfile` gains `intoProfileId` —
  a healthy original is rebuilt via `updateProfile` (the candidate pool never
  grows a stale duplicate of the same person); a degraded stub (no profile row)
  falls through to a fresh save and the entry is re-pointed. Triggers: the
  repeat carries a CV, or the original is degraded. A failed rebuild touches
  nothing.
- **Reachability ack**: a newly-backfilled contact gets the
  application-received ack that dead-lettered the first time (best-effort).

---

## Patterns worth keeping (→ harness-learnings)

1. **Terminal stages need ONE gate authority all surfaces import** (JOB1/JDL2):
   page, API, and CTA each gating independently is how drift starts; the 410 on
   the API is the part page-level gating can't fake.
2. **Decorate rankings with persisted state at the API boundary, not the
   client** (JOB2): the client unions optimistic session state on top; the
   server owns durable truth. A chunked-IN event-existence helper
   (`entryIdsWithEvent`) makes the decoration O(2 queries), not N+1.
3. **A dedup check is also a merge opportunity** (APP1): when the system can
   *identify* a repeat, it knows enough to *fold its fresh signals in*. Rebuild
   in place when the target row exists; save + re-point when it doesn't; and
   make the dedup-identity fallback only match rows that LACK the
   distinguishing field (contactless rows), so the stricter doctrine survives.
4. **Edit must not resurrect lifecycle** (JDL1): re-running ingest on body edit
   is safe only because the upsert preserves status — check what an "update"
   path preserves before wiring it to a richer writer.
