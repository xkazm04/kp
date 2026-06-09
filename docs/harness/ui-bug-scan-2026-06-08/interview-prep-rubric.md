# Interview Prep & Rubric — UI+Bug combined scan
> Total: 4 findings (1 crit / 2 high / 0 med / 1 low)
> Group: Interviews | Lens mix: 3 bug / 1 ui | Files read: 9

## 1. Regenerating a prep destroys the saved human scorecard (and any other prior payload key)
- **Severity**: Critical
- **Lens**: 🐛 Bug
- **Category**: Data loss / silent overwrite
- **File**: `app/_lib/interview-prep-run.ts:38-39` (write) → `app/_lib/interview-prep.ts:43-61` (`saveInterviewPrep` full-payload upsert)
- **Scenario**: A recruiter runs a human-led round, fills and saves the scorecard (POST → `humanScorecard` key persisted). Later anyone clicks "Regenerate" in `InterviewPrepModal` (footer, line 172-179, or the fallback banner, line 240-247). The `interview_prep` task runs `runInterviewPrep`, which builds a fresh `payload = { ...plan, source }` with NO `humanScorecard` / `userProgress` and calls `saveInterviewPrep`. That upsert does `ON CONFLICT(entry_id) DO UPDATE SET payload_json = excluded.payload_json` — a wholesale replace of the row's payload.
- **Root cause**: `runInterviewPrep` rebuilds the payload from scratch and the upsert overwrites the entire `payload_json`. Unlike `saveInterviewPrepProgress`/`saveHumanScorecard` (which read-merge), the generation path does not preserve the human-authored keys (`humanScorecard`, `userProgress`, `interviewer`). The modal clears its *local* checklist on regen (lines 107-111) — but a previously-saved scorecard from an earlier session is on the server only and is silently destroyed.
- **Impact**: Permanent loss of a recruiter's hand-entered ratings/evidence/verdict and assigned interviewer, with no warning or confirm. The `InterviewTranscriptModal`'s "human-led round" view (line 166-170, 227) then shows nothing.
- **Fix sketch**: In `runInterviewPrep`, read the existing artifact first and carry forward reserved human keys: `const prev = getInterviewPrep(entryId); const payload = { ...plan, source, ...(prev?.payload.humanScorecard ? { humanScorecard: prev.payload.humanScorecard } : {}) };` (and `userProgress`/`interviewer` if intentionally preserved). Or gate Regenerate behind a confirm when `humanScorecard` exists.

## 2. Lost-update race between the progress autosave (PUT) and the scorecard save (POST)
- **Severity**: High
- **Lens**: 🐛 Bug
- **Category**: Race condition / read-modify-write
- **File**: `app/_lib/interview-prep.ts:78-89` (progress) and `:97-105` (scorecard); triggered from `app/features/sub_schedule/InterviewPrepModal.tsx:74-86` (debounced PUT) + `app/features/sub_schedule/HumanScorecardPanel.tsx:57-77` (POST)
- **Scenario**: The interviewer ticks a checklist item / edits notes (debounced PUT fires at 600ms) and within the same window clicks "Save scorecard" (POST). Both handlers run `getInterviewPrep` → spread payload → `UPDATE ... SET payload_json = ?` on separate `better-sqlite3` connections with no transaction. The POST reads the payload *before* the PUT commits, so it writes back a payload missing the just-saved `userProgress`/`interviewer`; or the PUT reads before the POST commits and clobbers the new `humanScorecard`. Last write wins; the other human input is lost.
- **Root cause**: Two independent non-atomic read-modify-write paths mutate disjoint keys of the same JSON blob. The "ONE write so the human inputs can't race" comment (route.ts:35-38) only unifies checklist+notes+interviewer into one *PUT* — it does not coordinate with the *POST* scorecard path that shares the row.
- **Impact**: Silent loss of either the checklist/notes/interviewer or the scorecard on a common concurrent-edit path, exactly when the interviewer is multitasking during a live call.
- **Fix sketch**: Wrap each merge in a single SQLite transaction that re-reads inside the txn (`db().transaction(() => { read; merge; update; })()`), or do the merge in SQL via `json_patch`/`json_set` so the read and write are atomic per connection. Best: route both human-input writes through one merge helper using an immediate transaction.

## 3. Stale-closure / coalesced-write loses keystrokes on the debounced autosave
- **Severity**: High
- **Lens**: 🐛 Bug
- **Category**: Race / timing (debounce)
- **File**: `app/features/sub_schedule/InterviewPrepModal.tsx:74-86`
- **Scenario**: The effect captures `{ checked, notes, interviewer }` and schedules a PUT after 600ms, clearing the timer on each change. While the user keeps typing, the latest values are sent — fine. But the PUT body is a snapshot taken at *fire* time; if a render is skipped or the timeout fires between a state update and its commit, an in-flight save can carry slightly stale text. More importantly there is no de-dupe / ordering guard on the fetches: a slow first PUT and a fast second PUT can resolve out of order, and because each PUT sends the *full* `{checked,notes,interviewer}` triple, an out-of-order older response is harmless to the DB but a *re-render that re-fires hydration*… is guarded. The concrete loss: `dirtyRef` is a plain ref — if the modal unmounts (user closes it) during the 600ms debounce window, the cleanup `clearTimeout` cancels the pending save (line 85) and the last edit is never persisted.
- **Root cause**: The pending debounced PUT is canceled on unmount with no flush, and there is no `beforeunload`/close flush. The "best-effort, a blip shouldn't interrupt" comment (line 81-82) understates that a *normal close within 600ms of the last keystroke* drops that keystroke entirely.
- **Impact**: An interviewer who types a final note/quote and immediately closes the modal (very common at end of call) loses that last edit silently.
- **Fix sketch**: On unmount, if `dirtyRef.current`, flush synchronously (fire the PUT in the cleanup before clearing, e.g. with `keepalive: true` so it survives unmount/navigation), or shorten/flush-on-blur. At minimum send `{ keepalive: true }` and don't cancel an already-elapsed save.

## 4. Coverage counter can exceed the item total and the empty/zero state has no checklist affordance
- **Severity**: Low
- **Lens**: 🎨 UI
- **Category**: Missing/inconsistent state
- **File**: `app/features/sub_schedule/InterviewPrepModal.tsx:149-153, 233, 254-258`
- **Scenario**: `doneItems = Object.values(checked).filter(Boolean).length` counts *every* truthy key in the persisted `checked` map, while `totalItems` is derived from the *current* `prep.chronology.length + signals.length`. After Finding 1/2 type drift (or any payload whose generated body changed length but kept a `userProgress.checked` with more/old keys), `doneItems` can be greater than `totalItems`, rendering e.g. "9/6 done" and a `Meter` value over 100%. There is also no zero-item guard messaging: a payload with an empty chronology AND empty signals (degenerate generated plan) shows "0/0 done" with an empty run-of-show section and no "nothing to check" copy.
- **Root cause**: `doneItems` is computed from the stored map's cardinality rather than from keys that still correspond to a rendered item (`c-${i}` / `k-${i}` within current bounds). The meter clamps visually only if `Meter` clamps; the label does not.
- **Impact**: Confusing over-100% / "N/M where N>M" coverage readout; minor trust erosion in the live progress bar.
- **Fix sketch**: Count only live keys: derive valid keys from the current chronology/signals indices and intersect with `checked` before counting (e.g. `chronology.filter((_,i)=>checked['c-'+i]).length + signals.filter((_,i)=>checked['k-'+i]).length`). Clamp the meter value to ≤100 and show an empty-checklist note when `totalItems === 0`.
