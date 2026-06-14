> Total: 5 findings (Crit/High/Med/Low: 0/0/4/1)

## 1. Dead exported constant `KO_STEP_IDS` — superseded by `applyKoSteps()` derivation
- **Severity**: Medium
- **Category**: dead-code
- **File**: `app/_lib/apply.ts:36-37`
- **Evidence**: `KO_STEP_IDS = ["ko_auth", "ko_mode", "ko_lang"] as const` is exported but has ZERO live importers. The knockout gate in `app/api/apply/[id]/route.ts:234-237` derives the expected ids dynamically — `applyKoSteps(job, t).map((s) => s.id)` — and `app/api/apply/[id]/quick/route.ts:97-100` does the same. Greps proving certainty:
  - `Grep "KO_STEP_IDS" --glob **/*.{ts,tsx}` → **one** file only: `app/_lib/apply.ts` (its own declaration). No `import { KO_STEP_IDS }` anywhere.
  - `Grep "from \"@/app/_lib/apply\""` → all importers pull `applyKoSteps` / `buildApplyScript` / `buildApplyProfileDraft` / `applyDedupeKey` / `FALLBACK_ARCHETYPE` — never `KO_STEP_IDS`.
  - Only remaining hits are docs/backlog (`feature-scout-2026-06-08`, `ui-bug-scan-2026-06-08`, `idea-bca51493-make-apply-steps-self-describi.md`) describing it, plus a backlog idea explicitly proposing to "retire KO_STEP_IDS" — confirming it is recognized cruft. Not imported by tests (`apply-intake.test.ts` imports `failedKoStepIds` from `apply-intake.ts`, never the constant). It is the documented anti-pattern (a hand-maintained parallel list that must mirror what `buildApplyScript` conditionally emits, but isn't actually consulted).
- **Impact**: Misleading dead surface area: a maintainer reading `apply.ts` reasonably assumes the gate uses `KO_STEP_IDS`, when in fact the runtime source of truth is `applyKoSteps()`. The constant can silently drift from the real script (ko_mode/ko_lang are conditional) with no effect, masking the real contract.
- **Fix sketch**: Delete lines 36-37 (`/** The KO step ids … */` + `export const KO_STEP_IDS`). No call sites to update (zero importers). Leaves `applyKoSteps()` as the single, conditional-aware source. (Note: the broader backlog idea-bca51493 — folding KO semantics into each step — is a larger refactor; this finding is just the safe deletion of the already-unused constant.)

## 2. Unreferenced GET handler on `/api/apply/[id]` — "retained for standalone use" with no caller
- **Severity**: Medium
- **Category**: dead-code
- **File**: `app/api/apply/[id]/route.ts:148-163`
- **Evidence**: The GET handler returns `{ steps: buildApplyScript(job, t) }`, self-described (lines 148-156) as kept "for any standalone use of the script." But the apply page no longer fetches it — `app/apply/[id]/page.tsx:40` server-builds `buildApplyScript(job, t)` and passes `steps` as a prop to `ConversationalApply`. Greps proving certainty:
  - `Grep "fetch\([^)]*apply"` (whole repo) → only **one** apply fetch exists: `ConversationalApply.tsx:192` `fetch(`/api/apply/${jobId}`, { method: "POST" … })`. No GET fetch of this route anywhere.
  - `Grep "/api/apply"` in `e2e/` → no matches; no test file exercises the route (`app/api/apply/**/*.test.*` → none).
  - The only other client fetch in scope is `QuickApplyForm.tsx:64` → `/api/apply/${jobId}/quick` (POST).
- **Impact**: ~16 lines of unreachable handler plus its imports kept "just in case." It re-runs `getJob` and `buildApplyScript`, duplicating page.tsx's responsibility, and invites confusion about which path actually serves the script. Lower-certainty than #1 because it is a public Next.js route export (could in principle be called by an external integration), so flagged Medium, not High — but no in-repo caller exists.
- **Fix sketch**: Remove the `GET` export (lines 148-163). `getTranslations` import stays (POST uses it); `NextRequest` is still referenced by POST. Verify nothing external depends on it before deleting; if it must stay for a documented public contract, leave it but drop the "retained for standalone use" hedge and note it is contract-only.

## 3. Duplicated apply-email regex literal across all four intake surfaces
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/apply/[id]/ConversationalApply.tsx:291`, `app/apply/[id]/quick/QuickApplyForm.tsx:57`, `app/api/apply/[id]/route.ts:292`, `app/api/apply/[id]/quick/route.ts:79`
- **Evidence**: The identical literal `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` appears verbatim in all four apply files (grep `Grep "\^\[\^\\s@\]\+@\[\^\\s@\]\+"` → exactly those 4 hits, plus a sibling `lead-payload.ts:49` which already names it `EMAIL_RE`). The comments themselves acknowledge the coupling — ConversationalApply.tsx:291 "(same regex the server uses)", QuickApplyForm.tsx:57 "Same regex the server enforces". The client-side checks exist specifically to mirror the server's, so a divergence is a real correctness bug (client accepts what server rejects → bounced 400 that wipes the conversation, the exact failure ConversationalApply was designed to avoid).
- **Impact**: Four copies of one validation contract that MUST stay in lock-step; editing one (e.g. tightening the pattern) and missing another reintroduces the typo-only-caught-at-final-submit bug the client checks were added to fix. `lead-payload.ts` already proves the repo's preferred shape (`const EMAIL_RE = …`).
- **Fix sketch**: Add `export const APPLY_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;` to the registry-free `app/_lib/apply-intake.ts` (already the shared, test-pinned, `@/`-import-free home for the apply contract that both client bundles import — see ConversationalApply/QuickApplyForm already importing `isRetryableApplyStatus` from it). Replace the four inline literals with `APPLY_EMAIL_RE.test(...)`. Keep `lead-payload.ts`'s own `EMAIL_RE` as-is (different module/contract) or re-point it too. Pure mechanical swap; pinnable by `apply-intake.test.ts`.

## 4. Duplicated inline `buildApplicantProfile` answers object in the POST handler
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/api/apply/[id]/route.ts:322-336` and `375-386`
- **Evidence**: The POST builds the SAME 10-field `ApplyAnswers` literal twice — once on the re-apply/rebuild path (`buildApplicantProfile(job, { name, experience, skills, archetype, studentProject, studentEducation, studentAspirations, switchPrior, switchAspirations, cvText }, existing.candidateId)`, lines 322-336) and once on the fresh-application path (lines 375-386, identical field list, no `intoProfileId`). All ten locals are the already-parsed `const`s from lines 255-272, so both objects are byte-identical apart from the third argument. Confirmed by reading the route end-to-end; the two blocks are within ~50 lines of each other.
- **Impact**: A future field added to the intake lanes (e.g. a new archetype lane answer) must be remembered in two places; forgetting one means the re-apply rebuild and the first-apply build silently diverge — a re-applicant's profile would be built from a different answer set than a first-time applicant. Pure maintenance hazard.
- **Fix sketch**: After parsing the locals (around line 272), build the object once: `const intakeAnswers: ApplyAnswers = { name, experience, skills, archetype, studentProject, studentEducation, studentAspirations, switchPrior, switchAspirations, cvText };` then call `buildApplicantProfile(job, intakeAnswers, existing.candidateId)` at line 322 and `buildApplicantProfile(job, intakeAnswers)` at line 375. Mechanical; same module, no signature change.

## 5. Redundant `startFresh` indirection in ConversationalApply
- **Severity**: Low
- **Category**: cleanup
- **File**: `app/apply/[id]/ConversationalApply.tsx:259`
- **Evidence**: `const startFresh = () => restartConversation();` is a zero-value wrapper — it takes no args and adds no behavior over `restartConversation` (lines 239-254). Its only use site is the resumed-draft banner button `onClick={startFresh}` (line 355). The two functions are semantically identical (both clear `answeredRef`, `finalAnswersRef`, the draft key, and reset to step 0); the wrapper exists only for a naming alias. Confirmed by reading the component — `startFresh` is referenced exactly once.
- **Impact**: Cosmetic. One extra named function and an indirection a reader must follow to discover it just calls `restartConversation`. Very low risk either way.
- **Fix sketch**: Either delete `startFresh` and use `onClick={restartConversation}` at line 355, or (if the distinct name is wanted for the banner's intent) keep it but drop the standalone declaration in favor of inlining. Trivial; no other call sites. Leave as-is if the intent-naming is considered worth the indirection — flagged Low for exactly that reason.
