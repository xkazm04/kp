# Interview Simulation & Comparison — UI Perfectionist scan

> Context: Simulate an interview round, attach simulated outcomes to a candidate, compare interviews, and produce interview recommendations (incl. student mode).
> Files reviewed: 9 of 9 (plus 6 dependency files: InterviewSidebar, SegmentedControl, recipes, useJsonFetch, JobsShared/EmptyState, JobPostingModal, globals.css)
> Total: 7 findings — Critical: 0, High: 2, Medium: 3, Low: 2

## 1. Mode picker is a custom radiogroup with no keyboard navigation (and a shared one already exists)

- **Severity**: High
- **Category**: a11y / component-extraction
- **File**: `app/features/sub_interview/InterviewSimTab.tsx:181-205` (vs `app/_components/SegmentedControl.tsx`)
- **Scenario**: A keyboard or screen-reader user tabs to the "Student / Student-case / Regular" mode selector and presses Arrow keys to choose a lane.
- **Root cause**: The three mode cards are hand-rolled `role="radio"` buttons inside a `role="radiogroup"`, but there is no `onKeyDown`, no roving `tabIndex` (every card is a tab stop), and no Arrow/Home/End handling. The ARIA `radiogroup` contract promises arrow-key selection that this implementation does not deliver, so AT announces a radiogroup that behaves like three unrelated buttons. The app already ships `SegmentedControl<T>` which implements exactly this pattern correctly (roving tabindex, Arrow/Home/End, dev-warning on off-taxonomy value).
- **Impact**: Broken keyboard semantics on a primary control; WCAG 2.1.1 / 4.1.2 gap. Also a missed reuse opportunity — the behavior is re-derived and diverges from the app standard.
- **Fix sketch**: Replace the bespoke radiogroup with `<SegmentedControl label={t("modeAria")} options={MODES.map(...)} value={mode} onChange={pick} />`, or if the card visual must stay, add a roving `tabIndex` + `onKeyDown` that moves selection on Arrow/Home/End. The icon/label/blurb can be passed via the option `label` ReactNode.

## 2. Pipeline-fetch failure in "Attach to candidate" is indistinguishable from "no candidates"

- **Severity**: High
- **Category**: error-state / silent-failure
- **File**: `app/features/sub_interview/InterviewSimTab.tsx:51-62` (`.catch(() => setEntries([]))`), rendered at `:92-96`
- **Scenario**: A recruiter finishes a practice run, clicks "Attach to candidate", but `GET /api/pipeline` fails (offline, 500, auth expired).
- **Root cause**: The catch handler sets `entries` to `[]`, which the render treats identically to a genuinely empty board — it shows the `t("noCandidates")` empty message. There is no error branch and no retry; a transient network failure is presented as a definitive "you have no active candidates."
- **Impact**: The recruiter is told a falsehood ("no candidates") and has no way to recover except closing/reopening the control, which silently refetches only because `entries===null` again — but after a `[]` it stays empty forever within the session. The whole attach feature appears dead on any fetch hiccup.
- **Fix sketch**: Track a distinct error state (`setEntries`/`setLoadError`), render an error message with a retry button when the fetch rejects, and only render `noCandidates` when the request succeeded with an empty list. Reusing `useJsonFetch` (which already separates `error` from empty `data` and exposes `reload`) would remove the hand-rolled fetch entirely.

## 3. Compare grid has no loading skeleton and no retry on error

- **Severity**: Medium
- **Category**: missing-loading-state / error-state
- **File**: `app/features/sub_jobs/CompareInterviews.tsx:161-180`
- **Scenario**: Recruiter opens the "Compare" tab of a job; the `/api/interview/compare` request is slow or fails.
- **Root cause**: Loading renders a bare line of grey text `t("loading")` (no skeleton table), and the error branch renders `t(error)` with no retry affordance — even though `useJsonFetch` returns a `reload()` callback specifically for an error-state retry button, which this consumer destructures away (`const { data, error } = ...`). Every other data tab in the workspace shows a skeleton via the shared `loading` fallback.
- **Impact**: Inconsistent perceived-performance vs the rest of the app (text flash instead of a skeleton → layout shift when the table appears), and a transient compare-API failure is a dead end with no recovery.
- **Fix sketch**: Pull `reload` from `useJsonFetch` and render a retry button in the error state; replace the loading text with a `Skeleton`/placeholder table of the same shape (sticky competency column + N candidate columns) to hold layout and match the workspace pattern.

## 4. Rating-cell evidence quotes are reachable only via hover `title` tooltips

- **Severity**: Medium
- **Category**: a11y
- **File**: `app/features/sub_jobs/CompareInterviews.tsx:128`, `:137-142` (`title={r.evidence}`, `title={comp.description}`)
- **Scenario**: A touch user or keyboard/screen-reader user wants to see the evidence quote behind a competency rating in the comparison matrix.
- **Root cause**: In the matrix table, the rating chip's supporting evidence and the competency description are exposed only through the native `title` attribute, which never appears on touch and is inconsistently surfaced by AT. The file's own comment (`:217-218`) states "the quotes ARE the scorecard's accountability, so they must not hide behind hover tooltips" — yet the table cells still rely on `title`. (The evidence list further down mitigates this for evidenced ratings, but the per-cell rating→quote linkage in the grid is hover-only.)
- **Impact**: On mobile and for AT users, the most decision-relevant data (why a 2 vs a 4) is invisible in the grid; contradicts the component's stated accessibility intent.
- **Fix sketch**: Wrap the rating chip in a focusable element with `aria-describedby` pointing at the evidence text, or render the quote in an accessible popover/disclosure rather than `title`. At minimum add `aria-label` on the chip combining the competency, rating, and evidence.

## 5. "Attached" success state is terminal — can't attach a second candidate or undo

- **Severity**: Medium
- **Category**: interaction-correctness
- **File**: `app/features/sub_interview/InterviewSimTab.tsx:81-124`
- **Scenario**: A recruiter attaches a practice run to candidate A, then realizes it should also (or instead) be noted on candidate B.
- **Root cause**: Once `state === "done"`, the whole control collapses to a static success line (`:83-85`) and the toggle/select/attach UI is removed entirely. There is no "attach to another" affordance and no undo; the only escape is the global "Start over" which discards the entire session.
- **Impact**: A single mis-click permanently ends the attach flow for that session; recruiters who want to note a practice round on multiple records (a plausible workflow) must re-run the whole simulation.
- **Fix sketch**: After success, keep the control mounted and offer "Attach to another candidate" (reset `state` to `idle`, clear `sel`) and/or show which entry it was attached to. Optionally surface the candidate label in the confirmation for traceability.

## 6. Mode-card tilt and `dark:shadow-sticker-sm` are applied with no reduced-motion / contrast guard, and student "constructs" chips can overflow

- **Severity**: Low
- **Category**: visual-consistency / polish
- **File**: `app/features/sub_interview/InterviewSimTab.tsx:187`, `:261-267`
- **Scenario**: Spark Dark theme user views the mode picker; or a student script with many distinct `feeds` constructs renders the chip row.
- **Root cause**: (a) The decorative `dark:rotate-1 / dark:-rotate-1` tilt on unpicked cards is a one-off inline pattern rather than the shared `CHIP`/`PANEL_SUNKEN` token rides that already encode the same Spark-Dark tilt convention — drift from the design system. (b) The constructs chips (`constructs.map`) use `flex-wrap gap-1` with no max/overflow treatment; a long taxonomy wraps to many rows, pushing the Start button down unpredictably.
- **Impact**: Minor visual inconsistency with the tokenized tilt convention and a slightly unstable pre-start panel height. Low blast radius.
- **Fix sketch**: Use the existing `CHIP_QUIET`/`CHIP` recipes (which already carry the dark-tilt convention) for the chips, and consider capping the visible constructs (e.g. first 8 + "+N more") so the panel height is stable.

## 7. `key={i}` array-index keys on candidate columns and evidence cards

- **Severity**: Low
- **Category**: correctness / React-keys
- **File**: `app/features/sub_jobs/CompareInterviews.tsx:71`, `:131-134`, `:212`
- **Scenario**: The compare data refetches and the candidate ordering changes (a new human-only candidate is unioned in at `compare/route.ts:58`, shifting indices).
- **Root cause**: Candidate `<th>`/`<td>` columns and the evidence cards key on the array index rather than a stable `entryId`. Each candidate carries `entryId`, but it is unused as a key. When the list reorders or grows, React reconciles by position, which can mis-associate cell state and trip subtle render bugs.
- **Impact**: Low today (cells are largely stateless), but fragile — title tooltips/animations could attach to the wrong column after a reorder.
- **Fix sketch**: Key columns and cards on `c.entryId ?? c.candidateLabel ?? i` and the rubric rows are already keyed on `comp.competency` (good); apply the same discipline to the candidate axis.
