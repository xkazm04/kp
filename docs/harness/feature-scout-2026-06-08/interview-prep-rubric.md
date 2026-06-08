# Feature Scout — Interview Prep & Rubric (kp)

> Total: 6 opportunities (High: 3, Medium: 2, Low: 1)
> Files read: ~11

## 1. Human interviewer scorecard — fill the rubric live from the prep modal
- **Value**: High
- **Category**: feature
- **Effort**: M
- **Where it slots in**: `app/features/sub_schedule/InterviewPrepModal.tsx:133` — the run-of-show body; `app/_lib/interview-rubric.ts:41` (`rubricForArchetype`); `app/_lib/interview-scorecard.ts:35` (`Scorecard`)
- **Gap**: Today the ONLY scorecard is AI-synthesized from the voice interview (`Scorecard`, populated by LLM synthesis and read in `InterviewTranscriptModal` / `CompareInterviews`). When a HUMAN runs the interview there is nowhere to record per-competency ratings + evidence. The rubric (`rubricForArchetype`, with full BARS anchors for early-career) exists and is rendered in the compare grid, but the prep modal never imports it — the interviewer preps and scores in two disconnected worlds.
- **Opportunity**: Add a "Score this interview" panel to the prep modal that renders the archetype-correct rubric (`rubricForArchetype(entry.archetype)`) with each competency, its anchors, and a 1–`RATING_MAX` selector + evidence textarea. Save as a `Scorecard` tagged `source: "human"` keyed on `entry.id`.
- **Why it matters**: Closes the prep → live interview → scorecard loop for human-led rounds; human ratings then flow into the same Decisions / compare surfaces as the AI ones.
- **Sketch**: New `POST /api/interview-prep/scorecard`; persist alongside the prep artifact (reuse `interview_preps` or a sibling table); render rubric rows beneath the run-of-show; reuse `Meter`/`ratingTone` from `InterviewTranscriptModal`.

## 2. Persist the prep checklist + interviewer notes
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where it slots in**: `app/features/sub_schedule/InterviewPrepModal.tsx:26` (`const [checked, setChecked]`)
- **Gap**: The coverage checklist is pure in-memory `useState` — every tick is lost the instant the modal closes, and there is no free-text notes field anywhere. An interviewer who closes the modal mid-prep, or wants to jot a quote during the call, loses everything. The reassuring `doneItems/totalItems` meter resets to 0/N on reopen.
- **Opportunity**: Persist `checked` + a per-block notes field back to the prep artifact (the `payload_json` already round-trips through `saveInterviewPrep`). Reopening restores ticks, progress, and notes; notes can seed the human scorecard's evidence quotes (#1).
- **Why it matters**: Makes the prep guide a durable working surface across the prep-then-interview gap, and captures the verbatim quotes the rubric explicitly demands ("quotable specifics").
- **Sketch**: Add `PUT /api/interview-prep?entry=` writing `{ checked, notes }` into the artifact payload; debounce-save on change; hydrate `checked` from `data.prep.payload` on load.

## 3. Export / copy / print the prep guide
- **Value**: High
- **Category**: user_benefit
- **Effort**: S
- **Where it slots in**: `app/features/sub_schedule/InterviewPrepModal.tsx:77` (the modal `footer`, next to Regenerate)
- **Gap**: Zero export path in the whole schedule surface — no clipboard, print, or download (confirmed by grep). The timed run-of-show, scenario, and signals live only inside a React modal; an interviewer who runs the call in another tool, on paper, or alongside a panelist cannot take the plan with them.
- **Opportunity**: Add "Copy as Markdown" (writes scenario + chronology + signals to `navigator.clipboard`) and "Print" (`window.print()` against a print-styled view) buttons to the footer.
- **Why it matters**: One-click portability into the actual interview environment — a tiny change that unblocks every interviewer not glued to this exact screen.
- **Sketch**: Pure client; serialize `prep` to a Markdown string; add a `@media print` block so the modal body prints clean. No API change.

## 4. Editable questions + a reusable role question bank
- **Value**: Medium
- **Category**: feature
- **Effort**: L
- **Where it slots in**: `app/_lib/interview-prep-run.ts:29` (questions only ever come from the `prep` automation); `app/_lib/run-of-show.ts:62` (`MAX_QUESTIONS` hard-drops surplus)
- **Gap**: The chronology questions are 100% machine-generated (LLM or deterministic fallback) and immutable in the UI — the interviewer can't add, edit, reorder, or swap a question, and surplus CV questions past `MAX_QUESTIONS` are silently dropped with no way to recover them. There is no concept of a saved, role-level question bank to draw from.
- **Opportunity**: Let the interviewer edit chronology questions in-place and pull from a per-role question bank (saved questions reusable across every candidate on that job), persisted with the prep artifact.
- **Why it matters**: Standardizes questioning across candidates for the same role (comparability — the same goal the case-grounded student script already pursues) and gives humans authorship over an otherwise black-box plan.
- **Sketch**: New `interview_question_bank` table keyed by `jobId`; an "Add from bank / Save to bank" control per block; editable question rows write back into the persisted prep payload (builds on #2).

## 5. Interviewer assignment on the schedule card
- **Value**: Medium
- **Category**: functionality
- **Effort**: M
- **Where it slots in**: `app/features/sub_schedule/ScheduleTab.tsx:233` (`CandidateCardHeader`); `app/features/sub_schedule/ScheduleTypes.ts:1` (`SchedEntry`)
- **Gap**: No notion of WHO conducts the interview. The transcript modal labels the AI turn "Interviewer (AI)" but the product has no human-interviewer field — no assignment, no name, no panel. A recruiter scheduling several candidates can't record or see who owns each interview.
- **Opportunity**: Add an interviewer assignment (name/email select) to each pending card, stamped on the prep artifact and shown on the card + in the prep/transcript modal header.
- **Why it matters**: Basic ATS-parity for multi-interviewer teams; also scopes the human scorecard (#1) and notes (#2) to a named owner for accountability.
- **Sketch**: `interviewer` column on the prep artifact (or `approvalDetail` extension); a small select in the schedule card; surface in `CandidateCardHeader`'s trailing slot and the modal subtitle.

## 6. Show the rubric anchors inside the prep modal
- **Value**: Low
- **Category**: integration
- **Effort**: S
- **Where it slots in**: `app/features/sub_schedule/InterviewPrepModal.tsx:203` (after the "Signals to confirm" section); source `app/_lib/interview-rubric.ts:41`
- **Gap**: The interviewer preps without ever seeing the rubric they (or the AI) will be scored against. The rich early-career BARS anchors in `interview-rubrics.json` only appear in the post-hoc `CompareInterviews` grid — never during prep, when knowing "what a 4 looks like" actually shapes the questions asked.
- **Opportunity**: Render a collapsible "Rubric for this candidate" block in the prep modal using `rubricForArchetype(entry.archetype)` + `RATING_ANCHORS`, showing each competency, description, and per-level anchors.
- **Why it matters**: Calibrates the interviewer before the call so questions target the constructs being rated — cheap, high-signal, and a natural on-ramp to the live human scorecard (#1).
- **Sketch**: Pass `entry.archetype` (already on `SchedEntry`) into the modal; import `rubricForArchetype`/`RATING_ANCHORS`; render BARS rows in a `<details>` accordion. Read-only, no API change.
