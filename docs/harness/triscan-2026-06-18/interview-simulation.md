# Interview Simulation & Comparison — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 2 High / 2 Medium / 0 Low
> Lens: 2 bug / 1 ui / 2 biz

## 1. "Attach to candidate" is dead — simulate mints `candidate` mode, attach demands `test`
- **Lens**: 🐛 Bug Hunter
- **Severity**: Critical
- **Category**: Mode mismatch / silent failure (success-theater)
- **Value**: impact 9/10 · effort 2/10 · risk 2/10
- **File**: `app/api/interview/simulate/route.ts:61` ↔ `app/api/interview/simulate/attach/route.ts:22`
- **Scenario**: Recruiter takes a practice screen, opens "Attach to a candidate's record", picks a candidate, clicks Attach → always 404 → red "Couldn't attach the session." Every attach, every time.
- **Root cause**: `simulate` hardcodes `createInterviewSession({ mode: "candidate" })` (line 61), but `attach` rejects anything where `session.mode !== "test"` (line 22, comment "Only test-mode sessions qualify"). The two routes disagree on what a sim session is. The whole d95fed6d feature ("practice runs used to evaporate") is non-functional — no test catches it because `attach/route.ts` has no `.test.ts` exercising a real simulate-created token.
- **Impact**: The sole exit from a practice run other than "Start over" is broken; the headline annotation feature silently never works while the UI advertises it.
- **Fix sketch**: Either set `mode: "test"` in `simulate/route.ts` (matches `connect/route.ts:128` lab convention and the consent module's `mode === "test"` semantics in `interview-consent.ts:23`), or relax the attach guard to accept the sim's actual mode. Prefer `mode: "test"` so consent/scoring gates correctly treat it as a no-candidate lab session. Add an attach route test using a token from `createInterviewSession`.

## 2. Sim produces no scorecard, so the "calibration / prep" promise has no payoff
- **Lens**: 🚀 Business Visionary
- **Severity**: High
- **Category**: Value dead-end / differentiation
- **Value**: impact 8/10 · effort 6/10 · risk 4/10
- **File**: `app/api/interview/simulate/route.ts:59-68`; `app/api/interview/complete/route.ts:150-161`
- **Scenario**: A recruiter (or, in student mode, a student) finishes the full six-phase screen and gets… nothing. No "here's how the AI would have rated this", no comparison to the rubric they just experienced. The session has `entryId: null`, and `complete` only synthesizes a scorecard when `session.entryId` is set — so a sim is structurally unscorable.
- **Root cause**: The "no pipeline side-effects" contract was implemented as "no scorecard at all", conflating *not moving the pipeline* with *not generating feedback*. The transcript is captured but never turned into the very artifact the tool exists to teach.
- **Impact**: The simulator demonstrates the conversation but not the *judgment* — the actual product value (calibration for recruiters, self-assessment for the student market that the prompt calls "a distinct market"). It's a demo, not a prep tool.
- **Fix sketch**: On sim completion, run the scorecard synthesis against the mode's rubric (early_career for student lanes, experienced for regular) into an ephemeral/display-only result — never persisted to a pipeline entry. Surface a "what the AI would score" panel post-call. Keeps the no-side-effects contract while delivering the calibration payoff.

## 3. Compare grid offers no retry on load failure (the hook supports one)
- **Lens**: 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: Error state / dead-end
- **Value**: impact 5/10 · effort 2/10 · risk 1/10
- **File**: `app/features/sub_jobs/CompareInterviews.tsx:161,170`
- **Scenario**: A transient 500 / dropped connection on `/api/interview/compare` renders a bare red line `"Couldn't load interviews."` with no recourse — the recruiter must reload the whole page (and re-navigate to the job + tab).
- **Root cause**: `useJsonFetch` was built to return `reload()` precisely for a retry button (see its header comment), but `CompareInterviews` destructures only `{ data, error }` and drops it. The error branch is a non-interactive `<p>`.
- **Impact**: A momentary backend hiccup looks like a hard failure at the exact surface where the hire decision is weighed; recruiters lose trust or abandon the comparison.
- **Fix sketch**: Pull `reload` from the hook and render a "Try again" button in the error branch (a pattern likely already used by sibling tabs). One-line destructure change + a button.

## 4. Sim attach is one-shot and irreversible — terminal "done" hides the control
- **Lens**: 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: Polish / journey friction
- **Value**: impact 4/10 · effort 3/10 · risk 2/10
- **File**: `app/features/sub_interview/InterviewSimTab.tsx:83-85,124`
- **Scenario**: After a successful attach, the entire `AttachToCandidate` control collapses to a static "Attached — the practice session now shows in the candidate's history." line. The recruiter can't attach the same practice run to a second relevant candidate, can't undo a mis-pick, and gets no link to where the note landed.
- **Root cause**: `state === "done"` replaces the whole control instead of resetting to idle with a confirmation toast; no "attach to another" affordance and no deep-link to the candidate drawer.
- **Impact**: A wrong-candidate attach (easy: the select defaults to `list[0]`, see lines 59/104) is unrecoverable from this surface, and a genuinely reusable practice note can only be filed once. Minor but real friction on an annotation feature.
- **Fix sketch**: After success, show an inline confirmation but keep the picker available ("Attached ✓ — attach to another?"), and/or render the attached candidate's label as a link. Optionally guard against re-attaching the same token to the same entry.

## 5. Student mode is buried inside a recruiter-only dashboard tab
- **Lens**: 🚀 Business Visionary
- **Severity**: High
- **Category**: Market reach / journey dead-end
- **Value**: impact 7/10 · effort 5/10 · risk 4/10
- **File**: `app/features/sub_interview/InterviewSimTab.tsx:128-206`; `app/api/interview/simulate/route.ts:45-57`
- **Scenario**: The prompt flags "student mode = a distinct market." Yet the only entry to the student lanes (`student`, `student-case`) is the `InterviewSimTab` living inside the recruiter dashboard. A student has no first-class door — they can't self-serve a practice round; only a logged-in recruiter can spin one up, and even then the result evaporates (see #2).
- **Root cause**: Student practice was built as a *recruiter-facing simulator mode* (one of three radio cards) rather than a standalone student journey with its own surface, persistence, and (eventual) feedback. The two student modes default the radio (`useState("student")`) but sit behind the recruiter app shell.
- **Impact**: The distinct early-career/student market the product names is reachable only as a recruiter demo. No acquisition path, no repeat-use loop, no shareable practice link for a candidate — the differentiator stays latent.
- **Fix sketch**: Expose a tokenless or self-served student-practice route (reuse `studentInterviewerInstructions` / `DEMO_CASE_SCENARIO`) outside the recruiter dashboard, paired with finding #2's feedback panel so a student leaves with a self-assessment. Keep the recruiter simulator as-is for calibration. Scope as a thin new entry point over existing sim machinery.
