# High Fix Wave 8 — chart accessibility

> 3 chart findings closed in 1 commit. Theme: *a chart's data must have a text equivalent and
> a non-color encoding* (WCAG 1.1.1 / 1.4.1). Baseline preserved: tsc **0**, `next build` ✓,
> unit **1019/1019**, i18n parity (2824 keys).

## Commit `b1efde7`

| Chart | Gap | Fix |
|---|---|---|
| **ReliabilityDiagram** (Calibration) | SVG `role="img"` announced only the axis *names* — the dots (the actual calibration signal) had no text equivalent. | Marked the SVG `aria-hidden` and added a visually-hidden (`sr-only`) `<ul>` listing each filled bin: "{Predicted} 0.70, {Observed} 0.62 (n=5)" (axis labels localized; counts language-neutral). |
| **Momentum bars** (AnalyticsTab) | A bare `<li aria-label=…>` isn't reliably announced (no role). | Moved the per-week summary onto the bar group as `role="img" aria-label=…` (which also makes its decorative bar children presentational) while keeping the `<ol>/<li>` list structure. |
| **CohortProbe heatmap** (Dev) | Miss-severity was encoded by color tint **only** (coral/amber/moss). | Added a color-independent band word ("high / some / low") visible in the chip + an `aria-label` stating the severity ("75 percent missed, high miss rate"). |

## Pattern catalogue additions
34. **A chart needs a text equivalent.** An `aria-label` of just the axis names is not the
    data — expose the series as a visually-hidden list/table and mark the visual `aria-hidden`.
35. **`role="img"` + `aria-label` beats a bare labeled `<li>`/`<div>`.** A label only reliably
    announces when the node has a role (or is focusable); `role="img"` also hides the
    decorative children from AT for free.
36. **Never encode meaning in color alone (WCAG 1.4.1).** Pair every color band with a word,
    glyph, or text qualifier so low-vision / colorblind users get the same signal.

## Chart-a11y items still open (Medium, future pass)
- Analytics funnel bars misuse `role="progressbar"`; near-zero bars render as invisible
  slivers reading as "0" — a funnel-chart a11y + visual-floor cleanup (Mediums in the report).
