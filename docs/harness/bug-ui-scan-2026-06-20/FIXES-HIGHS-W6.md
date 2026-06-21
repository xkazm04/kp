# High Fix Wave 6 — accessibility (a11y) sweep

> 7 findings closed in 3 commits. Theme: *correct the ARIA semantics, announce errors, and
> make custom widgets keyboard-operable.* No new i18n strings (reused keys + ARIA attributes).
> Baseline preserved: tsc **0**, `next build` ✓, unit **1019/1019**, i18n parity (2824 keys).

## Commits

| Commit | Findings | Fix |
|---|---|---|
| `074e3d6` | analysis-result, screening, plans | **ResultPanel** tabs each set `aria-controls` to a per-tab panel id but only one tabpanel renders → all tabs now point at one stable `result-tabpanel` id (WCAG 4.1.2). **Decisions** role-filter + governance `<select>`s had only a `title` → added `aria-label`. **Billing** free/BYOM meter rendered a `progressbar` with `aria-valuemax=0` (invalid) → a 0-allowance meter no longer renders the bar. |
| `9265c4f` | landing, sourcing | **Login** error wasn't announced or associated → `role="alert"` + id, with `aria-invalid`/`aria-describedby` on the password input (the production entry point). **RecruiterCandidates** "couldn't add" error was visible but silent to SR → `role="alert"`. |
| `6d923eb` | guided-sim, interview-sim | **SimExplainDrawer** claimed `role="dialog"` but is deliberately non-modal → dropped the role so the labeled `<aside>` is an honest complementary landmark. **InterviewSim** mode picker (`role="radiogroup"` of `role="radio"` cards) was Tab-only → added roving tabindex + arrow-key navigation (the standard radiogroup contract). |

## Deliberately scoped out (bigger, separate waves)
- **Full shared-`Modal` migration of the 5 hand-rolled dialogs** (CandidateDrawer, MatrixTab,
  PipelineExplorer, SimExplainDrawer, FeaturePreviews) — a real focus-trap/scroll-lock
  refactor across 5 components; high-risk, deserves its own focused pass. (SimExplainDrawer's
  *mislabeled role* was the cheap honest fix and is done here.)
- **Kanban drag-to-move keyboard/SR path** (PipelineBoard) — needs a full keyboard DnD design
  or a documented alternative; the drawer `<select>` is the existing fallback.
- **Week-grid calendar `<div>`→`<table>` semantics** (ScheduleCalendar) — a structural rewrite.
- **Chart accessibility** (reliability diagram, momentum/cohort heatmaps) — need data-table
  or per-series `aria` equivalents; a coherent chart-a11y mini-wave.
- **Voice-interview live-audio a11y** (transcript re-announce, mic-permission state, audio
  controls) — domain-specific, several interacting findings.

## Pattern catalogue additions
26. **One panel, one id.** A tabs widget that renders only the active panel must give that
    panel a single stable id and point every tab's `aria-controls` at it — per-tab ids
    dangle for the inactive tabs.
27. **`title` is not an accessible name.** Form controls need a `<label>` or `aria-label`;
    a `title` tooltip alone leaves the control unnamed for screen readers.
28. **An error a user can see must also be announced.** Wrap inline error text in
    `role="alert"` (and associate it with its input via `aria-describedby`).
29. **Don't claim `role="dialog"` for a non-modal panel.** It promises focus management the
    panel doesn't provide — use the native landmark (`<aside>`/`role="region"`) + a label.
30. **A custom `role="radiogroup"` needs roving tabindex + arrow keys**, not just Tab-stops
    on every option — or reuse the shared control that already implements it.
