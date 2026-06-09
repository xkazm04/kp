# Analytics & Diagrams — UI+Bug combined scan
> Total: 4 findings (0 crit / 1 high / 2 med / 1 low)
> Group: Platform & Shared Infrastructure | Lens mix: 2 bug / 2 ui | Files read: 13

Note on the heavily-flagged hazards: the aggregation in `pipelineAnalytics` is genuinely
hardened. Conversion % guards the denominator (`reached[i-1] > 0`), `maxReached` is floored
at 1, every rate (`hireRatePct`, `advanceRatePct`) guards `m.total`, `daysSince` rejects
non-finite `Date.parse`, the time-to-hire path drops `NaN` via `d >= 0`, and `pickBottleneck`
has a min-sample guard. The PlantUML `maskSpans`/`NL`/`MASK` sentinels are real U+0001/U+0002
control chars (not the empty strings a plain read suggests — verified by byte dump), so span
masking preserves length correctly. The four findings below are the real residual gaps.

## 1. Analytics error state is a dead end — the hardened 500 path has no retry
- **Severity**: High
- **Lens**: 🎨 UI
- **Category**: Missing error-recovery state
- **File**: `app/features/sub_analytics/AnalyticsTab.tsx:25-27`
- **Scenario**: `/api/analytics/route.ts` was deliberately hardened to catch a transient DB fault (locked mid-write, migration race, disk full) and return `{ error }` with status 500. When that fires, `useJsonFetch` surfaces the message and exposes a `reload()` specifically documented as "for a retry button on the error state". `AnalyticsTab` destructures only `{ data, error }` — it drops `reload`.
- **Root cause**: The error branch renders a bare `<p className="text-base text-coral">{error}</p>` with no action. A transient, self-healing fault (the exact case the route was built to report) strands the user on a one-line red message; the only recovery is a full browser reload, which also re-mounts every other tab.
- **Impact**: The most likely real failure of this surface — a momentary DB hiccup — presents as a permanent broken dashboard. The recovery primitive already exists and is unused.
- **Fix sketch**: `const { data, error, reload } = useJsonFetch(...)`; render the error inside a small panel with a "Try again" button wired to `reload()` (matches the retry pattern the hook was designed for). Reuse the same coral text styling for the message.

## 2. Empty pipeline renders a populated-looking zero funnel — inconsistent with the other panels
- **Severity**: Medium
- **Lens**: 🎨 UI
- **Category**: Missing empty state / inconsistency
- **File**: `app/features/sub_analytics/AnalyticsTab.tsx:69-92`
- **Scenario**: With zero `pipeline_entries`, `pipelineAnalytics` still returns all five `FUNNEL_STAGES` with `reached: 0`, `current: 0`, `conversionPct: null`. The funnel list therefore renders five rows reading "0 … —", with empty `bg-paper` tracks.
- **Root cause**: The funnel array is always length-5, so the `.map` never produces zero rows and there is no `data.funnel.every(f => f.reached === 0)` guard. Meanwhile the sibling panels in the same component handle emptiness explicitly: By-role shows "No pipeline entries yet." (line 154-160) and By-archetype shows "No archetype data yet." (line 118-120). The funnel alone reads as a real-but-empty funnel rather than "no data".
- **Impact**: On a fresh install / new tenant the headline panel looks like a broken/stalled funnel instead of an honest empty state, and it is inconsistent with the two panels directly beside it. Low blast radius but it is the first thing a new user sees.
- **Fix sketch**: When `data.total === 0` (or all `reached` are 0), replace the funnel `<ul>` with the same "No pipeline entries yet." empty-state treatment used by the By-role table, so all three panels degrade consistently.

## 3. Diagram parse/layout failure dumps raw PlantUML source to the end user
- **Severity**: Medium
- **Lens**: 🐛 Bug / 🎨 UI
- **Category**: Degraded failure surface
- **File**: `app/_components/puml/PlantUml.tsx:404-412` (`failed` branch)
- **Scenario**: If `parsePuml` throws (caught → `diagram = null`) or the async `layoutDiagram`/ELK call rejects (ELK can fail to route certain cyclic or pathological graphs), `failed` becomes true and the component renders `<pre><code>{source.trim()}</code></pre>` — the raw `@startuml … @enduml` markup. This is reachable for any About-tab capability diagram (`AboutCoverageData.ts` bodies) and the diagrams page sources, all rendered through this same component.
- **Root cause**: The fallback was written to "show something" but shows internal diagram source rather than a human-facing message. There is no boundary distinguishing "couldn't render this diagram" from intentionally code-display content, and no signal/log on the layout-rejection path (the `.catch` only flips `failed`).
- **Impact**: A single malformed or unroutable diagram leaks implementation-looking PlantUML into a polished product surface with no explanation or recovery, and the failure is silent to operators (no console/telemetry on the catch). Degraded, not a crash — hence Medium.
- **Fix sketch**: In the `failed` branch render a captioned, neutral message ("This diagram couldn't be rendered") with the raw source collapsed behind a "Show source" toggle; log the layout-rejection in `.catch` (dev at minimum) so the failing source is diagnosable rather than only visible to whoever happens to view the page.

## 4. Funnel/archetype bars expose volume & conversion to sighted users only via the fill, but the percentage marker can render zero-width with the value buried
- **Severity**: Low
- **Lens**: 🎨 UI
- **Category**: Accessibility / chart semantics
- **File**: `app/features/sub_analytics/AnalyticsTab.tsx:73-89` and `112-115`
- **Scenario**: The funnel volume bar (`width: (reached/maxReached)*100%`) and the archetype advance bar (`width: advanceRatePct%`) are plain `<div>`s with no `role="progressbar"` / `aria-valuenow`/`aria-valuemax`. The numeric values are present as adjacent text, so a screen reader still reads the numbers — but the bars convey the *comparison* (which stage/archetype is largest, how steep the drop-off) purely visually, and when `advanceRatePct` is 0 the archetype bar collapses to zero width with the only cue being the trailing "0% advanced past screening" line.
- **Root cause**: Bars are decorative fills rather than semantic meters; the relationship between bars (the funnel's whole point) is not exposed in the accessibility tree.
- **Impact**: A screen-reader user gets the raw figures but not the at-a-glance shape (drop-off, biggest cohort) the chart exists to communicate. Genuinely low — no data is lost, only the visual comparison. Listed last for that reason.
- **Fix sketch**: Add `role="progressbar"` with `aria-valuenow={f.reached}` / `aria-valuemax={maxReached}` (and `aria-label` naming the stage) to the funnel track, and analogous attributes on the archetype bar. This is additive (no existing a11y is removed) and makes the comparison legible to assistive tech.
