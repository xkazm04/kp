# Biz+UI Scan — JD Library & Builder (2026-06-12)

> Total: 5 (3H/2M)

## 1. Stop showing analyzed candidates' names + scores on the public JD page
- **Lens**: business_visionary
- **Severity**: High
- **Category**: functionality
- **File**: `app/jds/[slug]/page.tsx:118`
- **Scenario**: The JD page is now deliberately candidate-facing — the Apply CTA ships on it (page.tsx:74-80, W8-2/JDL2) and `?lang=cs` link-sharing exists precisely so recruiters send this URL to candidates (proxy.ts:6-12). A candidate who follows that link sees, in the right-hand "Candidates" aside, every other applicant's `candidate_label` (typically a real name), their ScoreBadge, seniority and role family, sorted "by score" (page.tsx:118-151), plus "N candidates analyzed against this JD" in the header (page.tsx:66-71).
- **Root cause**: The candidates aside predates the apply bridge; when b8f1cd7 turned `/jds/[slug]` into the shared candidate artifact, the recruiter-only panel (`listAnalysesByJd`, db.ts:783) stayed on the same render with no audience split. This is not the deferred app-wide auth item — no login system can fix a page we *invite* candidates to.
- **Impact**: A candidate seeing "Jana Nováková — 43" is a GDPR personal-data exposure (EU/Czech market) and a brand-destroying moment for the recruiter; it also leaks the competitive field to every applicant. It directly undermines the "trust converts" principle the E-loop sourcing work is built on.
- **Fix sketch**: Remove the aside (and the header candidate-count sentence) from the public render and resurface the same `listAnalysesByJd` list on a recruiter surface: an expandable "Candidates (N)" section on each LibraryTab row (it already fetches `/api/jds` and could lazy-load `/api/jds/[slug]`-scoped analyses), or a workspace-side panel next to JdActions' edit drawer. Keep deep links to `/history/[slug]` exactly as today. No auth required; pure relocation.

## 2. Rehydrate a finished jd_build task — today the generated JD is unreachable after a tab switch
- **Lens**: business_visionary
- **Severity**: High
- **Category**: functionality
- **File**: `app/features/tasks/TasksTab.tsx:483`
- **Scenario**: A recruiter starts a 1–2 minute AI build, switches to Pipeline to work (the whole point of the background-tasks system and its TasksIndicator), then clicks the finished task's "Open the JD library" link — and lands on an empty builder form. The generated JD, role spec and salary band exist in `task.result`, but nothing ever shows them again; even the form inputs are gone.
- **Root cause**: `Workspace.tsx:190` unmounts LibraryTab entirely on tab switch (`navActive === "library" ? <LibraryTab /> : null`), destroying JdBuilder's local `taskId`/`result` state (JdBuilder.tsx:57-58); the result is consumed only via the in-render `useTaskResult(taskId)` bridge (JdBuilder.tsx:113-119). TasksTab's `outcomeLink` for `jd_build` is a bare `{ href: "/?tab=library" }` (TasksTab.tsx:483) with no task identity, and TaskOutcome renders the markdown only as a truncated one-line scalar.
- **Impact**: A paid LLM run (need analysis + design + web-grounded salary) is silently discarded; the recruiter must retype everything and burn a second build. It teaches users that backgrounding a task loses their work — eroding the headline value of the tasks system.
- **Fix sketch**: Make the outcome link `/?tab=library&jdTask=<task.id>`; in JdBuilder, alongside the existing `sp.get("jdTitle")` prefill pattern (JdBuilder.tsx:30-35), read `jdTask`, set it as the initial `taskId` (the existing `useTaskResult` consumption then restores the result for free) and seed title/company/seniority/lang from `task.params`. Optionally also auto-adopt the most recent unconsumed succeeded `jd_build` task on mount via TasksProvider.

## 3. Localize the public JD page chrome — the one candidate-facing surface still hardcoded English
- **Lens**: ui_perfectionist
- **Severity**: High
- **Category**: ui
- **File**: `app/jds/[slug]/page.tsx:79`
- **Scenario**: JDL5 (ad2038f) lets recruiters generate the JD body in Czech, and `?lang=cs` exists so the link opens in the candidate's language — yet the page frame around that Czech body stays English: "Apply for this role" (page.tsx:79), "Not accepting applications yet" (:86), "Job description ·" (:64), "Saved …" (:67-70), the archived banner (:106-111), "Candidates"/"by score" (:120-121), JdBody's copy tooltip, and all of JdActions ("Edit JD", "Archive", "Save changes").
- **Root cause**: Zero `useTranslations`/`getTranslations` anywhere under `app/jds/` (grep), while every other candidate route (apply, interview, offer, schedule, devcase) is on the catalogs. JdActions.tsx:14 lumps the page under "RES2's wave" (recruiter report-body labels) — a miscategorization: RES2 covers recruiter-only report internals, whereas this page carries the candidate conversion CTA.
- **Impact**: A Czech candidate reading a Czech JD must act through an English apply button — exactly the trust-killing inconsistency the bilingual campaign (8 commits) shipped to eliminate, on the single most-shared artifact in the product.
- **Fix sketch**: `getTranslations("jdPage")` in the server component, `useTranslations` in JdActions/JdBody, new `jdPage` block in messages/en.json + cs.json (same pattern as `app/apply/[id]/page.tsx`). Candidate-visible strings first (CTA, not-accepting note, archived banner); recruiter controls in the same sweep since the file is open.

## 4. Run the E7 specificity lint on pasted and edited JDs, not just builder output
- **Lens**: business_visionary
- **Severity**: Medium
- **Category**: user_benefit
- **File**: `app/features/sub_library/LibraryJdForm.tsx:83`
- **Scenario**: The live lint that flags "competitive salary"/"dynamický kolektiv" boilerplate and missing pay/place facts runs only under the AI builder's result (JdBuilderResult.tsx:123). A recruiter pasting an existing JD (LibraryJdForm.tsx:83-93) — the path most likely to carry agency boilerplate, since the text was authored elsewhere — gets no findings; neither does the in-place editor on the JD page (JdActions.tsx:83-89), so a clean JD can degrade on edit without warning.
- **Root cause**: E7 (`app/_lib/jd-lint.ts`) shipped wired to one consumer; the lint card UI lives inline in JdBuilderResult.tsx:258-279 and was never extracted, so the other two body-editing surfaces have nothing to reuse.
- **Impact**: The "concrete facts convert, boilerplate kills conversion" guard protects only AI-authored JDs — the minority case — while the most common real-world JDs go to candidates unchecked, inconsistently with the quality bar the builder enforces.
- **Fix sketch**: Extract the amber findings card into a shared `JdLintCard` (props: `body`, `salaryAvailable`) in sub_library; render it live under LibraryJdForm's textarea and JdActions' edit drawer with `salaryAvailable: false` (pasted/edited JDs have no structured band, so the prose money regex governs). Pure client-side rules — zero cost, same i18n keys.

## 5. Give archived JDs a way back — unarchive lives on a page you can no longer find
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `app/_lib/db.ts:858`
- **Scenario**: Archiving (W8-4/JDL1) drops a JD from `listJds` (`WHERE archived_at IS NULL`, db.ts:858) and therefore from the library list and the Analyze picker — but the only Unarchive control is on `/jds/[slug]` itself (JdActions.tsx:55-68). Once the row vanishes, no surface in the app lists archived JDs (grep "archived" across app/ — only db.ts, the jds API and the detail page). A recruiter who archives the wrong JD, or wants to revive a seasonal role, must remember the slug URL or hope it's still in Recents.
- **Root cause**: The archive feature shipped the write path and the detail-page toggle but no archived-list read path: `GET /api/jds` (route.ts:11) has no archived mode and LibraryTab has no filter state beyond the text query (LibraryTab.tsx:57).
- **Impact**: "Archive" silently behaves like soft-delete-with-a-secret-backdoor; recruiters either fear the button or lose JDs (and re-create duplicates — the exact failure archive was built to end). Seasonal re-hiring (re-open last year's role) is a core library retention loop and it dead-ends here.
- **Fix sketch**: Add `listJds({ includeArchived })` (or `archived_at IS NOT NULL` variant) + `GET /api/jds?archived=1`; in LibraryTab, a quiet "Show archived (N)" toggle next to the entry count rendering archived rows with a CHIP_QUIET "archived" badge and an inline Unarchive action (same PATCH `{ archived: false }` JdActions uses). Keeps default list clean; one query, existing patterns throughout.
