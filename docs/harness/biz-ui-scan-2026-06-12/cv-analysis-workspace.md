# Biz+UI Scan — CV Analysis Workspace (2026-06-12)

> Total: 5 (1H/3M/1L)
> Prior scans (2026-06-08, 2026-06-10) dedup'd: CV1–CV6, slug threading, candidate-name labeling, and per-run report language (CV3 — verified shipped at `app/api/analyze/route.ts:90-91`) are known and not re-flagged. All findings below are net-new.

## 1. Stop tagging JD-blind runs with the JD slug when the saved-JD body fetch fails
- **Lens**: business_visionary
- **Severity**: High
- **Category**: functionality
- **File**: `app/features/sub_analyze/useAnalyzeJdLibrary.ts:45`
- **Scenario**: The recruiter picks a saved JD from the dropdown. `pickJd` records the slug first (`useAnalyzeJdLibrary.ts:42`), then fetches the body — and if that fetch 404s (the JD list is loaded once per mount at `:21-33` and goes stale when a JD is deleted/renamed in Library) or errors, the failure is swallowed (`:47-48` non-ok → `null` → silent return; `:58-60` catch is a comment-only no-op). The picker still shows the JD as selected, the footer says "Ready to analyze" (`AnalyzeForm.tsx:189`), and the run proceeds with an empty JD while `jdSlug` rides along in the submit (`AnalyzeApi.ts:26`).
- **Root cause**: The submit gate only covers the in-flight case (`flags.jdLoading` in the button's `disabled` at `AnalyzeForm.tsx:198`; acknowledged in the hook's own comment `useAnalyzeJdLibrary.ts:9-12`) — the *failed*-load case leaves `selectedJdSlug` set with `jobDescriptionText` empty. `analyze-run.ts:67-68` then logs `jd_present: false` but `jd_slug: <slug>`, and `persistAnalysis(..., p.jdSlug, ...)` (`analyze-run.ts:165,195`) saves a history row claiming the role.
- **Impact**: A generic, JD-blind score is stored and displayed as a role-specific match. History, the history page's add-to-pipeline, and anything downstream keyed on `jd_slug` inherit a mis-attributed score — exactly the kind of silent data corruption a hiring tool can't afford, and the server log already disagrees with the row (`jd_present` false vs `jd_slug` set).
- **Fix sketch**: In `pickJd`, on non-ok/catch: `setSelectedJdSlug(null)` and surface an inline error through the picker's existing status slot (`AnalyzeSavedJdPicker.tsx:43-53` already alternates loading/detach there) — "Couldn't load this JD — pick again or paste it." Belt-and-suspenders: in `submit()` (`useAnalyzeForm.ts:372`), if `selectedJdSlug && !jobDescriptionText.trim() && !jobDescriptionFile`, block with the same message instead of posting.

## 2. Localize the analysis progress panel and run-failure messages (the longest-watched screen is English-only)
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `app/_components/AnalysisProgress.tsx:26`
- **Scenario**: A cs-locale recruiter submits a run. The entire form is Czech (Wave 4, b6ee6b9; 61 `analyze.*` keys in both catalogs), then the screen they stare at for the next 15–25 s flips to English: all six stage titles + subtitles (`AnalysisProgress.tsx:26-51`), "Live pipeline" / "Compiling result" (`:113`), "Almost there — packaging your report" (`:117`), "Comparing N CV variants in parallel." (`:124`), "Progress" (`:132`), "Cancel scan" (`:141`), and the `aria-label="Analysis progress"` (`:105`). Failures are English too: "Lost track of the analysis — please retry." (`AnalyzeApi.ts:77,85,93`), "The analysis is no longer available…" (`:83`), fallback "Analysis failed." (`runAnalysis.ts:60,73`), the JD-dropped warning (`runAnalysis.ts:129`) — all rendered in the form's `role="alert"` row (`AnalyzeForm.tsx:179-182`). Smaller leaks: "N variants"/"N chars" status labels (`useAnalyzeForm.ts:83,88,93` — the catalog already has unused-here `cvVariants`/`charsCount` keys) and `MAX_FILE_HINT` (`upload-constraints.ts:50`).
- **Root cause**: `AnalysisProgress.tsx` predates the i18n waves and imports no `useTranslations`; the API-layer strings live in non-component modules that were skipped by the catalog sweep. (The 2026-06-10 scout noted the two small leaks as out-of-scope defects; the progress panel itself — the bulk of the problem — was never reported.)
- **Impact**: The product's bilingual polish (a stated differentiator for the Czech market, reinforced by the just-shipped per-run report language) breaks at the moment of highest attention and at every failure, where English-only guidance is most costly.
- **Fix sketch**: Move `STAGE_LABEL` into `analyze.*` (or a new `progress.*`) keys and call `useTranslations` in `AnalysisProgress` (already a client component); have `watchAnalysis`/`executeAnalysis` reject with stable error codes that `useAnalyzeForm.onError` maps through the existing `errors` namespace; swap `useAnalyzeForm`'s literal labels for the existing `cvVariants`/`charsCount` keys (the hook already has `t` at `:28`).

## 3. Surface cached-replay provenance and stop duplicating history rows on re-runs
- **Lens**: business_visionary
- **Severity**: Medium
- **Category**: user_benefit
- **File**: `app/_lib/analyze-run.ts:165`
- **Scenario**: A recruiter re-runs the same CV against the same JD within 24 h (second opinion, accidental double submit, or a colleague's repeat). The prompt cache returns the stored payload (`analyze-run.ts:97-104`, TTL `cache.ts:9`), the client plays the same synthetic stage theatre, and the result lands looking like a fresh, independent model judgment. Meanwhile `persistAnalysis` runs unconditionally (`:165`, `:180`) and `saveAnalysis` always INSERTs a new slug (`db.ts:728-751`) — so History now lists the same candidate twice with identical payloads.
- **Root cause**: The per-variant `cached` flag is computed (`:102`, `:141`) and even logged (`cache_hit`, `:170`) but dropped from the returned payload, and the persist path has no awareness of cache hits.
- **Impact**: Trust + transparency — the app ships an `aiDisclosure` surface, yet silently presents a replay as a fresh evaluation ("the model re-confirmed my score" when nothing ran). Duplicate rows also degrade the recently shipped history search and any per-candidate counting.
- **Fix sketch**: Include `meta: { cached: true, cachedAt }` in the returned analysis (TS-side schema `.extend`, the same safe pattern `comparison`/`persistence` use); badge the result header "Cached result · Run fresh" with a bypass flag that skips `lookupCachedAnalysis`. On a full cache hit, reuse the most recent matching saved row (or at least skip the duplicate INSERT when an identical `payload_json` + `jd_slug` row exists) so re-runs link to the existing report instead of cloning it.

## 4. Keep the surviving CV variants when one variant fails mid-comparison
- **Lens**: business_visionary
- **Severity**: Medium
- **Category**: functionality
- **File**: `app/_lib/analyze-run.ts:145`
- **Scenario**: The recruiter compares 3 CV variants (a flagship differentiator vs a plain ATS). One PDF fails extraction or the LLM call errors. All three variants complete (`Promise.all`, `:84-143` — successes are even written to the cache at `:139`), then the first failure aborts the whole run (`:145-155`): no winner, no comparison, nothing persisted, and the thrown message is the raw stderr-derived text (`:113-115`) that never names which file failed (the label only decorates a progress message the client's synthetic stage strip ignores).
- **Root cause**: The all-or-nothing `results.find((r) => !r.ok) → throw AnalyzeError` policy treats a partial comparison as a total failure, discarding already-computed (and already-paid) sibling analyses.
- **Impact**: The comparison feature is most fragile exactly when used with real-world messy files; the recruiter loses the entire run, can't tell which variant to remove, and perceives the paid analysis as wasted — a direct retention hit on the feature that justifies the tool over an ATS.
- **Fix sketch**: When at least one variant succeeds, continue: build `buildComparison` over the successes (single success → the existing single path), persist the winner, and attach a non-fatal `variantErrors: [{ label, error }]` to the payload (schema `.extend`, like `comparison`) rendered as a warning banner in the result header. At minimum, prefix the thrown message with the failing variant's label so the retry is one file-removal instead of guesswork.

## 5. Show the picked JD's title — not "3 421 chars" — in the column pill and collapsed summary
- **Lens**: ui_perfectionist
- **Severity**: Low
- **Category**: ui
- **File**: `app/features/sub_analyze/useAnalyzeForm.ts:85`
- **Scenario**: The recruiter picks "Senior Java — Acme" from the saved-JD dropdown. The library fetch fills the textarea, so `jobStatus` resolves to `{ tone: "attached", label: "3421 chars" }` (`useAnalyzeForm.ts:85-90` — file name, else char count; the selected slug is never consulted). That label is what survives everywhere the form is summarized: the column's attached pill (`AnalyzeColumn.tsx:60-67`) and the collapsed bar shown for the entire run/result lifetime (`AnalyzeFormCollapsed.tsx:90`), i.e. precisely during the batch-screening loop ("same role, next CV") where confirming the armed role matters.
- **Root cause**: `jobStatus` predates the JD library integration; the title is available client-side (`jdLibrary` holds `JdSummary.title`, rendered in the dropdown at `AnalyzeSavedJdPicker.tsx:71-75`) but the status derivation ignores `selectedJdSlug`.
- **Impact**: The recruiter must re-expand the form to verify which role candidates are being scored against — friction in the highest-frequency loop and a real wrong-role risk; a char count is meaningless hierarchy where identity belongs.
- **Fix sketch**: In `useAnalyzeForm`, derive `jobStatus` with priority: selected JD title (`jdLibrary.find(j => j.slug === selectedJdSlug)?.title`) → file name → `t("charsCount", { count })`. The collapsed summary and column pill inherit the fix with zero changes; truncation is already handled (`truncate` + `title=` at both render sites).
