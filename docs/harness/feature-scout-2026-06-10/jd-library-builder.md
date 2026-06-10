# Feature Scout — JD Library & Builder (2026-06-10)

> Total: 6 (3H/2M/1L)

## 1. Add edit + archive to saved JDs (the library is append-only)
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where**: `app/api/jds/[slug]/route.ts:7` (GET-only) (+ `app/_lib/db.ts:742-782` saveJd/listJds/loadJd, `app/features/sub_library/LibraryTab.tsx:130`, `app/jds/[slug]/page.tsx:47`)
- **Gap**: The `jds` table has no update, delete, or archive path anywhere — the slug route is GET-only and the only `DELETE FROM jds` in the codebase is the simulation cleaner (`sim-store.ts:61`). A typo'd or obsolete JD is permanent; the only "fix" is saving a duplicate under a new slug, which forks the analysis history (analyses key on `jd_slug`) and leaves the stale copy in the Analyze picker forever.
- **Proposal**: Add `PATCH /api/jds/[slug]` (title/body via the shared `validateJdFields`) and an `archived_at` column with archive/unarchive actions on the JD page and library rows. Archived JDs drop out of `listJds` and the Analyze picker, but their public page still renders (with an "archived" banner) so existing analysis links never 404. On a body edit of a builder-saved JD, best-effort re-run `ingestStructuredJob` under the existing `jd-<slug>` id — `insertJob`'s ON CONFLICT upsert already updates fields while deliberately preserving lifecycle status (`app/_lib/job-ingest.ts:68-79`), so an edit can't demote a live job.
- **Why users need it**: Recruiters iterate on role wording constantly; today every revision is a new permanent row and the library degrades into a pile of near-duplicates with no way to retire any of them.

## 2. Put an Apply CTA on the public JD page (JD → apply bridge)
- **Value**: High
- **Category**: user_benefit
- **Effort**: S
- **Where**: `app/jds/[slug]/page.tsx:58-73` (+ `app/apply/[id]/page.tsx:11`, `app/features/sub_jobs/JobPostingModal.tsx:28-39` copyApplyLink, `app/_lib/job-ingest.ts:123` listJobStatuses)
- **Gap**: The JD page is the public, shareable, now-bilingual candidate-facing artifact, but a candidate landing on it has zero path to apply — the header offers only recruiter actions ("Analyze CV") and the disabled "Publish to job boards" stub. The conversational apply flow already exists at `/apply/jd-<slug>` the moment the role is live; today the apply link is only discoverable by a recruiter digging into the Jobs-tab posting modal.
- **Proposal**: Server-side, look up the linked job (`getJob("jd-" + slug)`): when its status is `published`, render an "Apply for this role" button linking to `/apply/jd-<slug>` plus a recruiter "Copy apply link" (reuse `publicBaseUrl`, mirroring JobPostingModal); when `draft` or no job exists, show a small recruiter-only hint ("not sourced/live yet") instead. Keep "Publish to job boards" as the separate future external-distribution feature per docs/JD_LIFECYCLE.md.
- **Why users need it**: It turns every saved JD page into a working careers page — recruiters share one URL and candidates can actually act on it, closing the JD → applicant loop end-to-end.

## 3. Make pasted JDs matchable — "Ingest as job" from the library
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where**: `app/api/jds/route.ts:33` (POST saves the row only) (+ `app/api/jobs/ingest/route.ts:26` ingestJobAd, `app/features/sub_library/LibraryJdForm.tsx:36`, `app/features/sub_library/LibraryTab.tsx:130`)
- **Gap**: Only the AI-builder path (`POST /api/jds/save`) creates the matchable `jd-<slug>` Job; a manually pasted JD (LibraryJdForm, or the Analyze tab's inline save — both POST `/api/jds`) is analysis-only forever: it can never be sourced into the Pipeline, ranked in the Matrix, matched, or applied to. The hardened LLM bridge exists (`ingestJobAd` + content-hash dedup + draft lifecycle, UI-wired in the Jobs tab since the 2026-06-08 campaign) but is only reachable by re-pasting the text there — which mints a Job with no `jds` row, losing the link in both directions.
- **Proposal**: Add an "Ingest as job" action on library rows / the JD page for JDs without a `jd-<slug>` job: POST `jd.body` through the existing `/api/jobs/ingest` (or call `ingestJobAd` directly) with explicit `jobId: "jd-" + slug` so JD and Job share identity, landing it in the same draft → Source-into-Pipeline lifecycle as authored JDs. Reuse the builder's `jobIngested`-style state to show the result inline.
- **Why users need it**: Recruiters who already have a written JD (the most common real-world case) currently hit a dead end — their saved JD can't participate in matching, sourcing, or apply, while the machinery to fix that already exists one tab away.

## 4. Show lifecycle status on library rows + job ↔ JD cross-links
- **Value**: Medium
- **Category**: user_benefit
- **Effort**: S
- **Where**: `app/features/sub_library/LibraryTab.tsx:130-150` (+ `app/api/jobs/status/route.ts:8`, `app/features/sub_jobs/JobPostingModal.tsx:114`, `app/features/sub_jobs/DraftsPanel.tsx:28`)
- **Gap**: Library rows show only title/slug/preview/date — nothing distinguishes a draft awaiting sourcing, a live sourced role, and a never-ingested paste; recruiters must open each JD or cross-reference the Jobs tab. In the reverse direction, `sub_jobs` contains zero references to `/jds/` — an authored job's posting modal renders a `jobToMarkdown` reconstruction with no link to the actual authored wording the recruiter edited.
- **Proposal**: Fetch `/api/jobs/status` once in LibraryTab and badge each row (Draft / Live / Not a job) keyed on `jd-<slug>`; let the Draft badge expose the same publish POST DraftsPanel uses so sourcing is one click from the library. Add a "View JD" link in JobPostingModal for jobs whose id starts with `jd-` (source `authored_jd`). Optionally add a per-JD analyzed-candidate count via one GROUP BY query (avoid per-row `listAnalysesByJd` N+1).
- **Why users need it**: The JD lifecycle (docs/JD_LIFECYCLE.md) is real but invisible from the library — the surface where recruiters actually manage JDs — so "did I ever source this?" requires a tab-hopping investigation.

## 5. Generate JDs in Czech — thread `lang` through the JD build
- **Value**: Medium
- **Category**: feature
- **Effort**: M
- **Where**: `app/_lib/jd-build-run.ts:102` (runJdBuild — no language param) (+ `app/_lib/devcase-run.ts` (no `--lang` anywhere), `app/_lib/analyze-run.ts:43` (the shipped pattern), `pipeline/jobfit/i18n.py:47`, `app/features/sub_library/JdBuilder.tsx:131`)
- **Gap**: Commit 7922fbe shipped bilingual chrome AND the LLM-narrative pattern (analyze threads `--lang`, `language_directive`, lang-keyed cache), but the JD builder — whose output is the single most candidate-visible document — still generates English only: neither the need→design CLIs nor `runMarketSalary` take a language, and `composeMarkdown`'s section headings ("About the role", "Responsibilities", jd-build-run.ts:84-96) are hardcoded English.
- **Proposal**: Add an output-language select (en/cs, defaulting to the active locale) to JdBuilder, thread it through the `jd_build` task into `runNeedAnalysis`/`runDesignArtifacts`/`runMarketSalary` exactly as analyze-run does (`--lang` + i18n.py directive), and localize `composeMarkdown`'s headings from the same lang. Template rendering needs no change (placeholders are language-neutral; authors can keep Czech template bodies).
- **Why users need it**: This is a Czech-market product (CZK bands, Europe/Prague) — recruiters currently hand-translate every generated JD before it can be shown to local candidates, despite the i18n plumbing already existing one call-path over.

## 6. Live rendered preview in the template editor
- **Value**: Low
- **Category**: user_benefit
- **Effort**: S
- **Where**: `app/features/sub_library/JdTemplateManager.tsx:113-120` (raw textarea only) (+ `app/features/sub_library/render-template.ts:88` pure renderTemplate, `app/features/sub_library/JdBuilderResult.tsx:249` the edit/preview tab idiom)
- **Gap**: Template authors edit raw markdown-with-placeholders blind — the unknown-token linter catches typos, but the only way to see what a template actually renders like (separator collapse, bullet expansion, heading layout) is to burn a 1–2 minute AI generation through it.
- **Proposal**: Add an Edit/Preview toggle to the editor pane that renders `editing.body` through the already-pure, already-client-side `renderTemplate` with fixed sample data (sample title/company/salary/bullets) into the shared `Markdown` component — the same tab idiom JdBuilderResult uses.
- **Why users need it**: Instant feedback while authoring company formats; today the author/verify loop costs an AI build per iteration.

---
## Cross-checks performed
- Read `docs/harness/feature-scout-2026-06-08/INDEX.md` + `docs/harness/harness-learnings.md`: the prior 60-item scan had NO JD-Library context; checked all 60 IDs — no collision (JOB1/JOB2 = Jobs-tab ad/URL ingest UI, not the library→catalog bridge; CV3 = inline save from Analyze, already shipped, distinct from all 6 above; retired Med/Low list VOX2/4/5, JOB5, DEC5/6, PREP4, SCH4, all-tabs-PDF — none overlap).
- Grepped `UPDATE jds|DELETE FROM jds|archived` across `app/` → only `sim-store.ts:61` (simulation cleanup); read `app/api/jds/[slug]/route.ts` → GET only. Confirms #1 (no edit/archive/delete exists).
- Read `app/jds/[slug]/page.tsx` fully → header actions are "Analyze CV" + disabled "Publish to job boards"; no apply link. Read `app/apply/[id]/page.tsx` + `JobPostingModal.tsx` → working `/apply/[jobId]` flow + copyApplyLink exist only in the Jobs tab. Confirms #2.
- Read `app/api/jds/route.ts` POST (saveJd only, no ingest), `app/api/jds/save/route.ts` + `ingest-job.ts` (builder-only ingest path), `app/api/jobs/ingest/route.ts` (ingestJobAd takes explicit jobId). Confirms #3's gap and feasibility.
- Read `LibraryTab.tsx` rows (no status/badges; search already exists — not re-proposed), `DraftsPanel.tsx` + `/api/jobs/status/route.ts` (status map exists); grepped `authored_jd|/jds/` in `sub_jobs/` → zero hits. Confirms #4.
- Grepped `lang|locale` in `jd-build-run.ts` (only `role.languages`) and `--lang|\blang\b` in `devcase-run.ts` (none); read `analyze-run.ts:25-43` (`--lang` shipped) and `pipeline/jobfit/i18n.py` (`language_directive` exists); `git show 7922fbe --stat`. Confirms #5 is unshipped but pattern-ready.
- Read `JdTemplateManager.tsx` (textarea + token linter, no preview) and `render-template.ts` (pure, client-importable). Confirms #6.
- Read `docs/JD_LIFECYCLE.md` end-to-end: respected its deliberate decisions — salary band stays AI-fixed (not proposed), internal `/publish` naming kept, "Publish to job boards" left as the separate future feature (#2 is the internal apply bridge, not external distribution).
- Also read: `db.ts:560-800` (jds/analyses schema + helpers), `jd-limits.ts`, `templates-store.ts`, `app/api/templates/*`, `useAnalyzeJdLibrary.ts` (Analyze consumes `/api/jds` — picker exists), `job-ingest.ts:52-133` (upsert preserves status), `tabs.ts:157-161` (jd* prefill params, simulation-only). Note: context file list named `JdTemplates.tsx`, which does not exist — the real surface is `JdTemplateManager.tsx`.
