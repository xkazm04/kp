# Biz+UI Scan — Interview Prep & Rubric (2026-06-12)

> Total: 4 (2H/2M/0L)
> Prior scans (2026-06-08, 2026-06-10) checked: PREP1/2/3/5, locale prep pack (90723fe), key-stable rubric localization (7a318b6) and the compare-grid human-only union all shipped; author/savedAt stamp (06-10 #4) is known-open and not re-flagged. Findings below are net-new.

## 1. Stop Regenerate from blanking — then destroying — preserved notes, checklist and interviewer
- **Lens**: ui_perfectionist
- **Severity**: High
- **Category**: functionality
- **File**: `app/features/sub_schedule/InterviewPrepModal.tsx:130`
- **Scenario**: A recruiter regenerates the prep plan (the amber fallback banner at `InterviewPrepModal.tsx:272-287` actively invites "Regenerate with AI"). Their notes, ticked checklist and assigned interviewer instantly vanish from the modal. If they then make any single edit (tick one box), the previously saved notes and interviewer are permanently destroyed server-side. If they don't edit, the "lost" notes silently resurrect on the next modal open.
- **Root cause**: Commit 483693b made the regeneration carry forward `humanScorecard`/`userProgress`/`interviewer` server-side (`app/_lib/interview-prep-run.ts:47-57`), but the modal still implements the OLD wipe semantics: `generate()` clears `checked`/`notes`/`interviewer` and pins `hydrated=true` with a now-false comment "the task re-saves the artifact with no userProgress" (`InterviewPrepModal.tsx:131-139`). The completed task result (which contains the carried-forward progress) is never hydrated into state (`InterviewPrepModal.tsx:64-71` only hydrates from the initial GET). The next genuine edit debounce-PUTs `{checked:{…}, notes:"", interviewer:""}` (`InterviewPrepModal.tsx:76-88`), and `saveInterviewPrepProgress` replaces `userProgress` wholesale and clears the interviewer (`app/_lib/interview-prep.ts:84-95`) — clobbering exactly what 483693b preserved.
- **Impact**: Silent loss of the interviewer's verbatim quotes (the evidence the rubric demands) and round ownership, on a hot path the UI itself promotes; when not destroyed, the blank-then-resurrect cycle makes autosave feel untrustworthy.
- **Fix sketch**: In the render-phase task-completion block (`InterviewPrepModal.tsx:123-128`), seed `checked`/`notes`/`interviewer` from `genFull.result`'s `userProgress`/`interviewer` (the carried-forward values) instead of leaving the cleared state; drop the clearing in `generate()` (keep `dirtyRef=false`) and fix the stale comment. Also pass the carried-forward `humanScorecard` from the result to `HumanScorecardPanel` (its `initial` at line 409 reads only the stale GET).

## 2. Keep human-interviewed candidates visible on the Schedule tab after their verdict is recorded
- **Lens**: business_visionary
- **Severity**: High
- **Category**: user_benefit
- **File**: `app/features/sub_schedule/ScheduleTab.tsx:96`
- **Scenario**: A recruiter runs a human-led round, fills the rubric scorecard and picks a verdict. The save silently moves the entry to the `scorecard_review` gate (DEC1) — and on the next Schedule load the candidate vanishes from the tab entirely: not in the calendar list, not in "Interviewed". The panel only says "Saved"; nothing explains the candidate is now in the Decisions queue, and the prep notes/scorecard surface becomes unreachable.
- **Root cause**: `calendarEntries` requires `approvalKind === "calendar"` (`ScheduleTab.tsx:96`) and `interviewedEntries` requires a voice transcript (`ScheduleTab.tsx:98-100`), so a `scorecard_review` entry with NO voice session is fetched (line 79-81) but rendered nowhere. The scorecard POST returns `{ ok, gated }` (`app/api/interview-prep/scorecard/route.ts:77-90`) but `HumanScorecardPanel.save()` never reads `gated` (`app/features/sub_schedule/HumanScorecardPanel.tsx:73-86`). Voice-interviewed cards have the same one-way door: the Interviewed card offers only the transcript button (`ScheduleTab.tsx:343-349`), so the prep modal — the ONLY surface for filling/editing the human scorecard and reading the notes — is unreachable the moment a round completes.
- **Impact**: The strongest human signal in the product ends the recruiter's session with a disappearing act — the same "wasn't interviewed" blind spot the compare grid just fixed, now on the surface where rounds are run. Recruiters can't add a human counter-opinion after reviewing an AI transcript (the compare grid explicitly renders both), and trust in the scorecard flow erodes.
- **Fix sketch**: Extend `listPreparedEntries` (`app/_lib/interview-prep.ts:143-163` — it already parses `payload_json`) to also return `hasHumanScorecard`; include `scorecard_review` entries with a human scorecard (no transcript) in `interviewedEntries` with a "Human-led" chip, and give Interviewed cards a secondary "Prep & scorecard" button (`setPrepEntry(e)` works for them unchanged). In `HumanScorecardPanel`, when the response has `gated: true`, show a confirmation line ("Verdict recorded — moved to the Decisions queue") so the state change is disclosed where it happens.

## 3. Make the selected "Hold" verdict pill legible in Spark Dark and align it with the app-wide hold tint
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `app/features/sub_schedule/HumanScorecardPanel.tsx:14`
- **Scenario**: In the new Spark Dark theme (HEAD 529f7a0), a recruiter selecting "Hold" on the human scorecard gets a pill with light-cream text on light-amber — roughly 1.6:1 contrast, effectively unreadable at the exact moment a verdict is chosen.
- **Root cause**: `REC_STYLE.hold` is the solid `bg-dial-amber text-ink` (`HumanScorecardPanel.tsx:14`). The dark seam flips `--color-ink` to `#f4efe3` while `--color-dial-amber` lightens to `#e5bd62` (`app/globals.css:106,113`), so the pair collapses. Every other hold surface uses the theme-safe 20% tint — `bg-dial-amber/20 text-ink` in `CompareInterviews.tsx:42`, `CandidateDrawer.tsx:37`, `HistoryTab.tsx:27`, `VoiceInterview.tsx:822` — making this panel both broken in dark and visually inconsistent in light. Same family of bypass nearby: `ScheduleTab.tsx:183-188` hard-codes light-theme hexes (`#d65a4a`, `#526b4f`, their rgba washes) into the framer-motion card-exit animation, so dark mode flashes light-palette coral/moss on confirm/decline.
- **Impact**: An illegible selected state on a hire/hold/reject control undermines the freshly shipped dual-theme system on one of its most consequential interactions; the off-convention solid fill also makes "hold" read differently here than on every sibling surface.
- **Fix sketch**: Change `REC_STYLE.hold` to the established `bg-dial-amber/20 text-ink` (optionally with `border border-dial-amber/50` to keep selected-state weight), matching the advance/reject pills' solid treatment only where contrast survives both themes; route the `cardExit` colors through the `useTheme()`/`brand.ts` DARK-mirror pattern the design commit established for FactorChart. (Note: `DispositionEditor.tsx:9` shares the solid `bg-dial-amber text-ink` pattern — flag for its own context.)

## 4. Let a rating be un-set, and show the BARS anchor before the rating is chosen
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `app/features/sub_schedule/HumanScorecardPanel.tsx:59`
- **Scenario**: A recruiter mis-taps "2" on a competency they never assessed. There is no way to clear it — the only options are leaving a false rating (which flows into the compare grid and, with a verdict, into the Decisions `scorecard_review` payload) or abandoning the form. Meanwhile the behavioral anchor ("what a 4 looks like") only appears AFTER a rating is selected, so the calibration text arrives when it can no longer guide the choice.
- **Root cause**: `setRating` only ever sets (`HumanScorecardPanel.tsx:59-60`); unlike the verdict pills, which toggle off on re-click (`setRecommendation((cur) => (cur === r ? "" : r))`, line 158), the 1..RATING_MAX buttons have no deselect — inconsistent even within the same form. The server already treats "unrated = omitted" (`app/api/interview-prep/scorecard/route.ts:44`), so only the UI blocks it. `anchorText` renders solely for the chosen value (`HumanScorecardPanel.tsx:119`), leaving the rich early-career BARS descriptors invisible pre-decision.
- **Impact**: Unremovable accidental ratings corrupt a decision artifact; anchors that appear post-hoc fail their entire calibration purpose, weakening rating comparability across candidates — the rubric's reason to exist.
- **Fix sketch**: Mirror the verdict toggle: clicking the selected value removes the key (`const { [competency]: _, ...rest } = f.ratings`); add `title={c.anchors?.[String(n)] ?? ratingAnchors[n]}` to each rating button so the level's anchor is readable on hover/long-press before committing (zero layout change, works with the localized anchors already in scope).

---
## Cross-checks performed
- Read both prior reports first; verified shipped status in git (`7a318b6`, `90723fe`, `483693b`, compare-route union, DEC1 gate) — none re-proposed. Known-open author/savedAt stamp and all listed deferrals excluded.
- Finding 1: traced `generate()` state clears against `interview-prep-run.ts` carry-forward and the PUT merge semantics (`saveInterviewPrepProgress` replaces `userProgress` and clears `interviewer` when sent empty) — clobber path confirmed end-to-end.
- Finding 2: confirmed the render filters drop `scorecard_review`-without-transcript entries from both lists; confirmed `gated` is returned but never read client-side; confirmed Interviewed cards expose only the transcript modal.
- Finding 3: checked the dark token remaps in `globals.css` (stock amber-*/stone-*/white remap — the modal's fallback banner is theme-safe; solid `dial-amber` + flipped `ink` is not); recipes.ts migration is documented as opportunistic, so literal panel strings were NOT flagged — only actual dark-theme breakage and convention divergence.
- Considered and not reported: copy-prep omitting notes/scorecard (rejected by 06-10 scan), prep-pack `lang` persisted but mismatch undisclosed in the modal (Low remnant of a shipped item), auto-generation gap (prep IS auto-started on Decisions accept, `DecisionsTab.tsx:136-143`), `CompareInterviews` human-only rendering (verified clean: chips at lines 99-118, distinct human section at 237+).
