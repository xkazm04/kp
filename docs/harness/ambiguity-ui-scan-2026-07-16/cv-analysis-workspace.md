# CV Analysis Workspace — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 1 high, 4 medium, 1 low)

## 1. Consent read-gate enforced only on the API detail route — the SSR saved-report page and the History list serve unmasked PII
- **Severity**: High
- **Lens**: ambiguity
- **Category**: consent-gate-coverage-drift
- **File**: `app/history/[slug]/page.tsx:159` (also `app/api/analyses/route.ts:8`)
- **Scenario**: A candidate's consent expires (or they are anonymized). Opening the saved report via the API (`GET /api/analyses/[slug]`) correctly masks the label, scrubs the CV payload, and withholds the GitHub dossier (`candidateLabelWithholdsPii` at `app/api/analyses/[slug]/route.ts:33-48`). But opening the same report at `/history/[slug]` — the primary human-facing surface — renders the full `candidate_label` as the page `<h1>`, the complete unscrubbed payload into `ResultPanel`, and revives `github_json` via `parseGithub`, with no withhold check at all. `GET /api/analyses` (the History list behind `HistoryTab`) likewise returns raw `candidate_label` rows, so the expired-consent candidate remains name-searchable in the list.
- **Root cause**: The read-time consent gate (bug-ui-scan-2026-07-09 privacy-consent-provenance #3) was implemented on one of the three read surfaces for the same rows. The SSR page calls `loadAnalysis` directly and predates/bypasses the gate; nothing shares the withhold projection between the API route and the page.
- **Impact**: The gate's own stated contract — "the read stays lawful even if the sweep is stalled" — is defeated on the surface recruiters actually use. Expired-consent/anonymized candidates' full CVs, names, and GitHub identities keep being served until the deferred anonymize sweep runs.
- **Fix sketch**: Lift the withhold projection into one shared helper (e.g. `projectAnalysisForRead(found, ws)` next to `parseStoredGithubAnalysis` in `app/_lib/db/analyses.ts`) that applies `candidateLabelWithholdsPii` + `maskCandidateName` + `scrubPiiFromPayload` + github withholding, and call it from both `app/api/analyses/[slug]/route.ts` and `app/history/[slug]/page.tsx`. For the list, batch-check labels in `GET /api/analyses` (or inside `listAnalyses`) and mask the withheld ones.

## 2. Replacing a CV variant bypasses the content-dedupe, and the server then silently collapses the comparison
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: replace-skips-dedupe
- **File**: `app/features/sub_analyze/useAnalyzeForm.ts:150`
- **Scenario**: A recruiter has variants A and B attached, hits Replace on B, and picks the same file as A (easy with lookalike filenames). The form now shows two variants and submits both; `collectCvFiles`' `dedupeCvVariants` (`app/api/analyze/route.ts:189`) silently drops the clone, the run executes with one variant, and the result is a plain single report — no comparison, no `partialFailures`, no explanation. Meanwhile the progress UI shows `variantCount=2` from `inputs.cvFiles` while the server reports `variantsTotal=1`, so the bar and the header disagree mid-run too.
- **Root cause**: The add path (`addCvFileInner`) checks `isDuplicateCvVariant`, but `replaceCvFile` is a bare `setCvFiles(map)` — the only intake mutation outside the serialized dedupe gate. The server's silent dedupe was designed for double-submits of the same file, not for turning a requested 2-way compare into a single run.
- **Impact**: The user asked for a comparison and got a single report with nothing naming why; the on-screen variant list (2 files) contradicts the delivered result (1 analysis), which reads like a lost variant.
- **Fix sketch**: Route replace through the same content-hash check: make `replaceCvFile` async, hash the incoming file against the *other* current variants (excluding the replaced index), and surface the existing inline `useFileAccept` rejection ("this file is already attached as variant A") instead of committing. That reuses `isDuplicateCvVariant` and keeps client and server agreeing on what a duplicate is.

## 3. Multi-file drop silently discards every file after the first
- **Severity**: Medium
- **Lens**: ui
- **Category**: multi-file-drop-dropped
- **File**: `app/features/sub_analyze/useGlobalFileDrag.ts:71` (also `useDropZoneHighlight.ts:36`)
- **Scenario**: The workspace advertises "drop a CV anywhere" and up to 3 CV variants (`MAX_CV_VARIANTS`), so a recruiter selects 3 CV files in Explorer and drops them onto the page in one gesture. Only `files[0]` is routed (`event.dataTransfer?.files?.[0] ?? null`); the other two vanish with no message, no error row, no hint. The same single-file slice exists in the labeled zones' `onDrop`.
- **Root cause**: Both drop handlers hard-code the first entry of `dataTransfer.files`. The variant-cap and accept gates all operate on one file per event, so a multi-select drop was never routed through them.
- **Impact**: The most natural gesture for building a best-of-3 comparison (select all three, drop once) silently produces a 1-variant run; the user either doesn't notice (wrong analysis shape) or must discover drag-one-at-a-time by trial and error.
- **Fix sketch**: In the window catch and the CV zone's `onDrop`, iterate `dataTransfer.files` up to the remaining variant capacity, feeding each through the existing `addFile` gate (which already serializes, dedupes, and reports cap overflow inline). For the single-file JD/company zones, keep `files[0]` but surface the existing inline error row when `files.length > 1` ("only one file can be attached here — the first was used").

## 4. Collapsed paste textarea stays keyboard-focusable while visually hidden — invisible editing
- **Severity**: Medium
- **Lens**: ui
- **Category**: hidden-focusable-textarea
- **File**: `app/features/sub_analyze/AnalyzePasteRow.tsx:46`
- **Scenario**: A JD has been pasted, so the row collapses to the preview card and the textarea gets `className="sr-only"` (kept in the DOM by design for tests/screen readers). A keyboard user tabbing through the form lands on this invisible textarea — focus disappears from the screen — and any typing edits the JD with no visible feedback (`hasContent` stays true and `isEditing` stays false, so it remains sr-only while receiving input). The visible Edit affordance is a separate button further along the tab order.
- **Root cause**: The collapse swaps visibility (`sr-only`) but not focusability, and nothing promotes focus into edit mode: there is no `onFocus={() => setIsEditing(true)}` and no `tabIndex={-1}` on the collapsed state.
- **Impact**: Keyboard users hit a focus black hole in the middle of the form and can mutate the JD text invisibly — a genuine accessibility regression on an otherwise carefully labeled surface, and a route to submitting a silently edited JD.
- **Fix sketch**: Add `onFocus={() => setIsEditing(true)}` to the TextArea so keyboard focus expands it exactly like clicking Edit (screen-reader users get the same behavior, and the sr-only test/AT contract is preserved). Alternatively set `tabIndex={-1}` while collapsed, but the focus-expands option is strictly better UX.

## 5. A GitHub-only run's result is fully ephemeral — lost on refresh or tab switch, and nothing says so
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: github-only-run-not-persisted
- **File**: `app/features/sub_analyze/useAnalyzeForm.ts:446`
- **Scenario**: A recruiter runs the GH3 flow (GitHub handle only, no CV). The deep-dive takes a while; they switch the segmented control to History or refresh the page. The main-analysis flow survives this (server task + `sessionStorage` resume + GH1 PATCH/restore onto the saved row), but the GitHub-only run has no server task, no saved analysis row, and no slug to PATCH — the result (or the still-running call) is simply gone, silently. Nothing in the UI distinguishes "this run will be saved to History" (CV runs) from "this result exists only in this render" (GitHub-only runs).
- **Root cause**: `submit()` returns early for `githubOnly` before any task/persistence machinery engages, and the GH1 persistence effect requires `analysis?.persistence?.slug`, which never exists here. The asymmetry is real architecture (the deep-dive is a stateless client fetch), but it is undocumented and invisible to the user.
- **Impact**: Users trained by the CV flow's refresh-resilience lose completed, rate-limit-bounded GitHub analyses (the deep-dive is explicitly retry-prone against GitHub rate limits) and can't find them in History, then re-run and burn the rate limit again.
- **Fix sketch**: Minimal honest fix: when `githubOnly`, render a one-line note next to the standalone `GithubAnalysisPanel` ("this deep-dive isn't saved — export or re-run to keep it"). Better: persist GitHub-only runs as a lightweight analyses row (label = handle, null score/payload variant, `github_json` attached) so they appear in History and survive refresh via the existing GH1 restore path.

## 6. Two error grammars in one form: intake errors are coral (the brand accent), run errors are red
- **Severity**: Low
- **Lens**: ui
- **Category**: error-color-inconsistency
- **File**: `app/features/sub_analyze/AnalyzeProfileInput.tsx:69` (vs `AnalyzeForm.tsx:194`)
- **Scenario**: A rejected file (wrong type, >8 MB, variant cap, failed sample fetch) renders as `text-coral` inline under the drop zone, while a failed run renders as `bg-red-50 text-red-700` in the status slot — two different "something went wrong" treatments inches apart in the same section. Coral is simultaneously the workspace's accent for links, the Required tag, icons, and the "pass" disposition pill, so a coral message does not read as an error at a glance.
- **Root cause**: `useFileAccept`'s error row (repeated in `AnalyzeFileDropZone.tsx:34`) adopted the brand accent instead of the red error tokens the run-error slot and HistoryTab's failure panel use.
- **Impact**: Visual severity is muddled: the file-was-rejected message competes with decorative coral accents and looks *less* severe than a run failure, though both block the user's goal equally.
- **Fix sketch**: Restyle the shared `errorRow` (both copies read from `useFileAccept`) to the same red error treatment as the run-error slot — e.g. `text-red-700` (optionally on `bg-red-50` when there's room) — keeping `role="alert"`. One palette for errors, coral reserved for accent/branding.
