# UI+Bug Scan — Fix Wave 8: Accessibility pass

> 10 findings closed (1 High, 5 Medium, 4 Low) across 6 atomic commits. 2 deferred (noted below).
> Baseline preserved: tsc 0 → 0, next build ✓, unit 638 → 638, lint clean.
> One mental model: **announce dynamic state, name every control, and respect motion/keyboard.**

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `c94bd4c` | modal fade-in ignores prefers-reduced-motion | Medium | globals.css |
| 2 | `f83df11` | Modal focus trap counts aria-disabled as boundary | Medium | Modal.tsx |
| 3 | `df6c216` | Fit Matrix has no table header semantics | High | MatrixTab.tsx |
| 4 | `861135d` | conversational apply stream not announced | Medium | ConversationalApply.tsx |
| 5 | `52563c2` | schedule-picker booking not announced | Medium | SchedulePicker.tsx |
| 6 | `7d973e8` | 5 unlabeled/visual-only controls (batch) | Med + Low×4 | TasksIndicator, JdTemplateManager, control/page, PipelineBoard, AnalyticsTab |

## What was fixed

- **Modal reduced-motion** — added `.animate-fade-in` to the reduced-motion media block (covers every modal + all fade-ins app-wide).
- **Modal focus trap** — the focusables filter now also excludes `aria-disabled="true"`, so Tab can't land on a control the user can't act on.
- **Fit Matrix semantics (High)** — `scope="col"` on the corner + column headers and the candidate row label is now `<th scope="row">`, so AT can announce candidate × position for each score cell.
- **conversational apply** — the chat list is `role="log" aria-live="polite"`, so each new bot prompt + the final outcome are announced (was silent on a public flow).
- **schedule picker** — the "You're booked" card is `role="status" aria-live="polite"` (the primary action no longer confirms silently for AT).
- **batch (6):** TasksIndicator (`role="alert"` on start-error, `aria-live` on running count, `aria-hidden` spinners); JdTemplateManager (`aria-label` on the name/body fields); control kill-switch glyph `aria-hidden` (state is in adjacent text); PipelineBoard scroll container `tabIndex/role="region"/aria-label` (keyboard-scrollable + named); AnalyticsTab funnel bars `role="progressbar"` + aria values.

## Deferred (2)

- **conversational apply per-step focus management** (conversational-apply #4, Med) — moving focus to the first control of each newly-rendered `ko`/`choice`/`file`/error/done step needs per-step-type focus refs threaded through the render; more involved than the aria-live fix above. Pairs naturally with it; left for a follow-up.
- **interview-prep coverage counter / empty state** (interview-prep #4, Low) — the "N/M done" can exceed the item total when the payload's `checked` keys outlive the rendered items; it's mostly a counting-math fix (intersect live keys) rather than pure a11y. Left for a follow-up.

## Verification (before / after)

| Gate | Baseline (B2) | After Wave 8 |
|---|---|---|
| tsc --noEmit | 0 errors | 0 errors |
| next build | ✓ | ✓ (Compiled successfully) |
| test:unit | 638 pass | 638 pass |
| eslint (touched files) | — | clean |

## Cumulative status (waves 1–8)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Trust-boundary & validation (security) | 8 |
| 2 | Data integrity | 7 |
| 3 | Identity-by-label / wrong-record | 5 |
| 4 | Concurrency & idempotency | 6 |
| 5 | Stale UI / fetch-state | 8 |
| 6 | Silent failures & opaque errors | 6 |
| 7 | Score / number / label consistency | 8 |
| 8 | Accessibility | 10 |
| | **Total** | **58** |

**25 findings remain: Wave 9 (UI states/polish, ~13) + 3 deferred (sim reset re-orphan, conversational focus, interview-prep counter) + the rest of W9's long tail.** All Medium/Low.

## Patterns established (catalogue item 21)

21. **Dynamic state surfaced visual-only.** A count that ticks, a streamed message, a success swap, an error banner, or a long-running progress bar that updates the DOM with no `role="status"`/`alert"`/`aria-live"`/`progressbar"` is invisible to assistive tech — especially damaging on public candidate flows. Pair every meaningful visual state change with a live region or role, name every placeholder-only control, and gate animation on `prefers-reduced-motion`.

## What remains

25 findings — **Wave 9 (UI states & polish, ~13 Med/Low)**: empty/loading states, z-index occlusion, non-wrapping headers, blank-screen edge, misleading copy, no-confirm destructive actions, etc. Plus 3 deferred Meds. This is the polish long tail.
