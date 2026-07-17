# Interview Simulation & Comparison — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 2 high, 3 medium, 1 low)

## 1. Attach-to-candidate is offered from the first second of a sim, but the server only accepts completed sessions
- **Severity**: High
- **Lens**: ambiguity
- **Category**: ui-server-contract-mismatch
- **File**: `app/features/sub_interview/InterviewSimTab.tsx:275`
- **Scenario**: A recruiter starts a simulation and, while the voice call is running (or after abandoning it without finishing), opens "Attach to candidate", picks an entry, and clicks attach. The request 404s and the UI shows only the generic `t("failed")` text with no explanation; retrying fails identically.
- **Root cause**: `AttachToCandidate` is rendered as soon as `session` exists (immediately after POST /simulate), but `app/api/interview/simulate/attach/route.ts:32` gates on `isAttachableSimSession`, which requires `endedAt != null` (`sim-session.ts:24-31` — a sim "created but never run" is deliberately refused). The client encodes no knowledge of this precondition and the 404 body ("Simulation session not found.") is not surfaced or distinguished from a network error.
- **Impact**: The feature reads as broken exactly when a recruiter is most likely to try it (mid-call, impressed by the run). Nothing tells them "finish the interview first", so some will conclude attach is dead — the same perception bug d95fed6d fixed once already, reintroduced at the UX layer.
- **Fix sketch**: Track completion client-side (VoiceInterviewClient already knows when the call ends) and keep the attach control disabled with a "available after the interview ends" hint until then. Additionally, in `attach()` read the response body and map the 404 to a specific message ("finish the simulation before attaching") instead of the generic `failed` string.

## 2. The "Not assessed (auto-synthesis unavailable)." placeholder leaks into the evidence list as real evidence
- **Severity**: High
- **Lens**: ambiguity
- **Category**: magic-string-sentinel-drift
- **File**: `app/features/sub_jobs/CompareInterviews.tsx:269`
- **Scenario**: A candidate's scorecard was produced by the auto-synthesis-unavailable fallback (`pipeline/jobfit/automation.py:788`, evidence `"Not assessed (auto-synthesis unavailable)."`, rating 3). In the compare grid's evidence section every axis renders as a green/neutral "3" badge with the placeholder sentence shown as if it were a verbatim quote.
- **Root cause**: The filter is an exact match against one sentinel spelling — `r.evidence !== "Not assessed."` — while Python emits at least two spellings and its own guards use the prefix contract `startswith("Not assessed")` (`automation.py:662`, `live_case.py:244`). The cross-language sentinel contract exists only implicitly, and the TS side implements a narrower version of it.
- **Impact**: A wall of rating-3 rows with boilerplate "evidence" reads as a mediocre-but-assessed interview, polluting the exact surface where hire decisions are compared; the quotes are the scorecard's stated accountability mechanism (comment at line 266-267), so fake quotes undermine it.
- **Fix sketch**: Match the Python contract: filter with `!r.evidence.startsWith("Not assessed")`. Better, export a shared `isPlaceholderEvidence()` predicate next to the rubric helpers (the interview-recommendation.ts pattern: single TS source mirroring the Python constant) and document the sentinel in the cross-language contract notes.

## 3. Compare grid can pair a candidate's scorecard with telemetry from a different session
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: mismatched-session-join
- **File**: `app/api/interview/compare/route.ts:16-20`
- **Scenario**: A candidate has two sessions on the entry — e.g. an older completed screen (scorecard shown by the grid) and a newer re-run that is in progress or ended without synthesis. The compare column shows the old session's ratings with the new session's talk-share/pause/hint line beneath them.
- **Root cause**: The scorecard comes from `interviewedForJob` (latest **completed** session per entry by `ended_at DESC`, `db/interviews.ts:40-61`), but `telemetryForEntry` re-reads via `latestInterviewByEntry`, which uses a different ordering (transcript-bearing first, then `created_at DESC`) and no `status = 'completed'` filter (`db/interviews.ts:307-315`). Two selectors, two definitions of "the candidate's interview". (It also costs an extra full-row query per candidate when `interviewedForJob` already parsed `scorecard_json`.)
- **Impact**: The "descriptive conversational-dynamics" line silently describes a different conversation than the verdict and ratings above it — subtly wrong input to a hire comparison, and undiagnosable because both values are individually real.
- **Fix sketch**: Return `telemetry` from `interviewedForJob` itself — it already selects and parses `scorecard_json` for the exact session whose ratings are displayed — and delete `telemetryForEntry`. That makes scorecard and telemetry provably same-session and removes the N+1 read.

## 4. Hardcoded `bg-white` on the sticky compare-table cells breaks the token palette and dark mode
- **Severity**: Medium
- **Lens**: ui
- **Category**: hardcoded-color-token
- **File**: `app/features/sub_jobs/CompareInterviews.tsx:116`
- **Scenario**: On a job with several candidates the table scrolls horizontally; the sticky "Competency" header and first column are painted literal `bg-white` (also line 178). Everywhere else this feature uses theme tokens (`bg-paper`, `text-ink`, `text-steel`), and the app ships a dark theme (Spark Dark styling in `InterviewSimTab.tsx:217`), where a white slab column sits on a dark table.
- **Root cause**: The sticky cells need an opaque background to occlude scrolled content and grabbed the nearest literal instead of the surface token the panel actually uses.
- **Impact**: In dark mode the frozen column/header is an unreadable white strip (dark-mode text tokens on white); in light mode it is subtly off from `bg-paper` siblings, so the seam is visible while scrolling.
- **Fix sketch**: Replace both `bg-white` occurrences with the surface token the containing panel uses (`bg-paper` or the PANEL recipe's surface), which already resolves per theme. Verify occlusion during horizontal scroll in both themes.

## 5. Attach success state is a dead end: no record of which candidate, no correction path
- **Severity**: Medium
- **Lens**: ui
- **Category**: irreversible-action-feedback
- **File**: `app/features/sub_interview/InterviewSimTab.tsx:96-97`
- **Scenario**: A recruiter attaches the sim and the whole control collapses to a bare "done" line. If they mis-picked in the Select (labels are `candidateLabel — jobTitle`, easily confused between same-named candidates), they only wrote a `sim_attached` event onto the wrong candidate's drawer history, and the UI now offers neither the chosen name for verification nor any way to attach to the right entry.
- **Root cause**: The `state === "done"` branch replaces the entire control and drops the selected entry's label; the component intentionally supports only one attach per session with no post-action context.
- **Impact**: A permanent annotation lands on a real candidate's audit history with no immediate confirmation of *who*, and correcting a slip requires finding the wrong candidate's drawer manually. Low-frequency but audit-trail-touching.
- **Fix sketch**: Render the confirmation with the chosen entry's label ("Attached to {name} — {job}") and keep a secondary "attach to another candidate" affordance that returns to the picker (the server is idempotent per entry event, or can be). That preserves the annotation-only contract while making mis-picks visible and recoverable.

## 6. Unknown `mode` on POST /api/interview/simulate silently coerces to "regular"
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: silent-input-coercion
- **File**: `app/api/interview/simulate/route.ts:35`
- **Scenario**: Any caller (a future surface, a script, a typo like `"students"` or `"student_case"`) posts an unrecognized mode. The route quietly mints a regular quick-screen demo and returns 200 with `simMode: "regular"`, so the caller believes they got what they asked for unless they inspect the echo.
- **Root cause**: `body.mode === "student" || body.mode === "student-case" ? body.mode : "regular"` treats "unknown" and "regular" as the same case; there is no validation error path, and the fallback choice is undocumented.
- **Impact**: A real voice session is created and the minutes meter is gate-checked/debited for the wrong interview format — wasted paid minutes and a confusing session, discovered only after the call starts on the wrong script.
- **Fix sketch**: Validate against the explicit set and return 400 for anything present-but-off-set (`if (body.mode !== undefined && !SIM_MODES.includes(body.mode)) return 400`), keeping "regular" as the default only for an *absent* mode. One comment line stating that default completes the contract.
