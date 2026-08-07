# Architecture Diagrams — ambiguity-guardian + ui-perfectionist scan

> Total: 5 findings (0 critical, 0 high, 3 medium, 2 low)

## 1. Drawer + renderer chrome is hardcoded English in a 13-locale app
- **Severity**: Medium
- **Lens**: ui
- **Category**: i18n-consistency
- **File**: `app/diagrams/PipelineExplorer.tsx:89`
- **Scenario**: The page went to real lengths to localize everything around the diagrams — eyebrow, title, intro, per-item label/blurb, legend, status pills, the explorer instruction, and the read-error message all flow through `t(...)`. Yet the moment a non-English user opens a step drawer they hit untranslated chrome: the `aria-label="Close"` button (`PipelineExplorer.tsx:89`) and the `Code` section heading (`PipelineExplorer.tsx:100`). The shared renderer is worse: `"This diagram is too large to render here."` (`PlantUml.tsx:429`), `"Couldn't render this diagram."` (`PlantUml.tsx:440`), `aria-label="Expand diagram to full screen"` (`PlantUml.tsx:472`), the zoom controls' `"Scroll to pan · zoom to adjust"` / `"1:1"` / `"Fit"` labels and the `"Diagram"` title fallback (`PlantUml.tsx:538`).
- **Root cause**: Localization was applied at the page level (`diagrams/page.tsx`, `PipelineExplorer` top) but stopped at the component boundary; the drawer body and the reusable `PlantUml` primitive were treated as "code UI" and never wired to `next-intl`. The distinction between "diagram body = code identifiers, stay untranslated" (a documented, defensible choice) silently swallowed genuine UI chrome that is NOT a code identifier.
- **Impact**: Mixed-language UI for every non-English locale, and — worse — the `aria-label="Close"` / `"Expand diagram to full screen"` strings are the accessible names screen-reader users hear, so the a11y experience is English-only. In a repo whose `i18n:check` gate enforces key parity across 13 locales, this is an inconsistency the gate cannot catch because the strings never became keys.
- **Fix sketch**: Add `diagrams.explorer.code`, `diagrams.explorer.close`, and a `diagrams.render.*` group (`tooLarge`, `failed`, `expand`, `zoomIn`, `zoomOut`, `panHint`, `fit`, `oneToOne`, `titleFallback`). Thread `useTranslations` into `StepDrawer` and pass the render strings into `PlantUml` as props (it is used outside `/diagrams`, so prefer props over coupling it to a fixed namespace).

## 2. The v1/v2 architecture diagrams parse non-strict — a typo'd alias silently fabricates a phantom box
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: silent-misinformation
- **File**: `app/diagrams/page.tsx:92`
- **Scenario**: The interactive funnel opts into `strict` parsing, so a mistyped edge endpoint is dropped + dev-warned + CI-guarded (`parse.test.ts` "zero unresolved endpoints"). But the two committed architecture diagrams — `01-system-architecture-v1.puml` and `02-system-architecture-v2.puml` — render through `<PlantUml source scale="natural" expandable />` with **no `strict`** (`page.tsx:92`). In non-strict mode `resolveEndpoint` auto-vivifies any unresolved endpoint into a fresh component node (`parse.ts:282-283`), and the unresolved-endpoint dev warning early-returns unless `strict` (`PlantUml.tsx:377`).
- **Root cause**: The "no phantom nodes" guarantee and its contract test were scoped to the declared-only funnel + `STEP_DETAILS`, on the assumption that only those are declared-only. The v1/v2 sources are equally declared-only component diagrams but were never opted in, and nothing (test or lint) asserts they are clean.
- **Impact**: A single typo'd alias in either architecture source ships a stray, disconnected box (or an edge silently bound to the wrong node) in the very diagrams the page frames as ground truth — "the real architecture sources … the page always reflects the committed source" (`page.tsx:13-15`). No warning fires anywhere; CI stays green.
- **Fix sketch**: Pass `strict` on line 92 (these are declared-only), and extend the `parse.test.ts` "zero unresolved endpoints" contract to also load `01-…v1.puml` and `02-…v2.puml`. If either legitimately relies on edge-only endpoints, keep it non-strict but add it to the contract as an explicit exception with a comment.

## 3. The status legend renders only for the featured diagram
- **Severity**: Medium
- **Lens**: ui
- **Category**: visual-hierarchy
- **File**: `app/diagrams/page.tsx:85`
- **Scenario**: `it.featured ? <Legend/> : null` shows the moss/coral/dashed-stone key only above the to-be funnel. The v1/v2 diagrams below it are drawn by the same `componentStyle` vocabulary (moss = live/auto, coral = gate, dashed stone = gap; `PlantUml.tsx:148-157`) and the intro even teaches `<<v2>>` tagging — but they render with zero legend. A user scrolls to "System architecture v1", sees green, coral, and dashed boxes, and has nothing on-screen explaining what the colours mean.
- **Root cause**: The legend was treated as a funnel affordance rather than a page-wide key for a shared visual language that all three diagrams speak.
- **Impact**: The colour encoding — the whole point of the styled renderer — is unreadable for two of the three diagrams; users either guess or scroll back up to the funnel's legend.
- **Fix sketch**: Render `<Legend>` once at page level (under the header, above the diagram list) instead of per-featured-item, or repeat it for every diagram that contains a stereotyped node. A single top-of-page legend is the smaller change and matches the shared-vocabulary intent.

## 4. Empty/unparseable diagrams leak raw PlantUML DSL to end users
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: leaked-internal-representation
- **File**: `app/_components/puml/PlantUml.tsx:444`
- **Scenario**: When a diagram parses to empty (`isEmpty`) the component renders the raw `.puml` source in a `<pre><code>` block (`PlantUml.tsx:444-449`). The genuine *failure* paths were deliberately upgraded to friendly messages ("Couldn't render this diagram."), but the empty-but-parseable path still dumps the DSL. On a product-facing architecture page, a reader who hits this sees `[POST /api/…] <<auto>> as api` markup presented as if it were the diagram.
- **Root cause**: The comment (`PlantUml.tsx:434`) calls raw source "a reasonable text fallback" — true for a Markdown code-block context, but this component is also the product's architecture surface, where the DSL is not meaningful output.
- **Impact**: A malformed or accidentally-empty `STEP_DETAILS.puml` / architecture source renders internal DSL to users, reading as a broken page rather than a graceful degrade — the exact impression the failure-path rework set out to remove.
- **Fix sketch**: Route the empty case to the same friendly `role="alert"` box as the failure case (or a distinct "Nothing to show" message), and keep the raw-`<pre>` fallback behind an opt-in prop for the Markdown/code-block callers that actually want it.

## 5. Coral hover/active stroke is hardcoded in the SVG `<style>`, bypassing the single-source colour map
- **Severity**: Low
- **Lens**: ui
- **Category**: token-drift
- **File**: `app/_components/puml/PlantUml.tsx:602`
- **Scenario**: `constants.ts` and the `C` map are documented as "the single home for every diagram colour … one map = one edit to re-tone a diagram," and `C.coral = "#d65a4a"` already exists. But the injected hover/focus/active `<style>` string hardcodes `#d65a4a` twice (`PlantUml.tsx:602`) as string literals, unreachable from the map. A designer retoning the coral accent edits `C.coral`, reruns, and the clickable-node hover/active border stays the old colour.
- **Root cause**: The interactive-state CSS lives in a template string rather than as inline SVG attributes, so it couldn't reference the `C` constant and a raw hex was pasted in — the precise "orphaned hex literal" hazard the `C` map was created to eliminate.
- **Impact**: Latent visual drift: the active-step border (the primary affordance tying the funnel to the open drawer) can silently disagree with the app's coral token after a retune. Cosmetic, but it undermines the stated single-source-of-truth invariant.
- **Fix sketch**: Interpolate `${C.coral}` into the `<style>` template instead of the literals, or move the hover/active styling onto the shape elements as `stroke`/`strokeWidth` props driven by the `active`/hover state so it flows from the same token map as every other colour.
