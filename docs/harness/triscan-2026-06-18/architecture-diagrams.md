# Architecture Diagrams — Tri-Lens Scan
> Total: 5
> Severity: 0 Critical / 1 High / 3 Medium / 1 Low
> Lens: 2 bug / 2 ui / 1 biz

> Hard-checked first (per brief): **XSS via unescaped SVG labels — NOT exploitable.** Every
> label / title / stereotype reaches the DOM only as a JSX *child* (`{box.label.toUpperCase()}`,
> `<tspan>{line}</tspan>`, `aria-label={...}`) — React escapes all of these. No label text is ever
> interpolated into a raw SVG attribute string (`d`, `transform`, `style`) or `dangerouslySetInnerHTML`
> (grep: zero hits in `app/_components/puml` + `app/diagrams`). The `<style>` block (PlantUml.tsx:579)
> is a static literal with no interpolation. `.puml` sources are also server-side and committed, not
> user input. Reported findings below are the genuine residue after that came back clean — only 5 real
> ones survived (brief allows ≥3); no XSS finding because there is no XSS.

## 1. Unbounded diagram size runs ELK layout synchronously on the main thread — large/adversarial source freezes the tab
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Performance / DoS-by-input
- **Value**: impact 7/10 · effort 4/10 · risk 3/10
- **File**: `app/_components/puml/layout.ts:116` (`layoutDiagram`) · `app/_components/puml/PlantUml.tsx:390`
- **Scenario**: A `.puml` with hundreds of nodes/edges (or a deeply nested package tree, or a pathological fan-out edge set) is handed straight to `elk.layout(graph)`. ELK's `layered` + `BRANDES_KOEPF` + `ORTHOGONAL` routing is super-linear in nodes×edges and runs in-process. The await yields to the microtask queue, but the layout computation itself is one synchronous CPU burst that pins the main thread — the page goes unresponsive (no spinner progress, no cancel). `parsePuml` has no node/edge cap either, so the cost scales with file size with zero ceiling.
- **Root cause**: No size guard anywhere in the parse → layout chain. The renderer trusts that sources are small/committed, but `PlantUml` is a reusable component (used inline, in the drawer, and per-step) with no defensive bound; elkjs runs on the main thread (not a worker).
- **Impact**: A single oversized or hand-crafted diagram (or a future authoring mistake — an accidental cartesian edge block) hard-freezes the diagrams page for everyone who loads it; `force-dynamic` means it re-runs every request.
- **Fix sketch**: After parse, count `index.size` + `edges.length`; above a threshold (e.g. >150 nodes or >300 edges) bail to the `failed`/`pre` fallback with a "diagram too large to render" message instead of calling ELK. Cheap, and it converts a freeze into a graceful degrade. (Stretch: move `elk.layout` into a Web Worker via `elkjs/lib/elk-worker`.)

## 2. SVG has `role="img"` + `aria-label` but no `<title>`, and individual nodes/edges expose no accessible names — diagram is opaque to screen readers and tooltips
- **Lens**: 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: Accessibility (a11y)
- **Value**: impact 6/10 · effort 3/10 · risk 1/10
- **File**: `app/_components/puml/PlantUml.tsx:560` (svg) · `:578` (interactive nodes) · `renderNode` :160
- **Scenario**: A screen-reader user reaches the diagram. The `<svg role="img" aria-label="Diagram: …">` announces only the title — the entire architecture (every component, gate, gap, edge) is a single opaque image with no internal structure. Worse, the *clickable* funnel nodes (`role="button" tabIndex=0`) carry **no accessible name** — a keyboard/SR user tabbing the funnel hears "button" 14 times with no idea which step. Native `<title>` is also what most browsers surface as a hover tooltip on SVG, so even sighted users get nothing on hover.
- **Root cause**: a11y was applied at the canvas level (good `aria-label`) but not propagated to the interactive children, and `role="img"` deliberately hides the subtree, so the per-node labels that *are* drawn as text aren't exposed.
- **Impact**: The page's headline interactive feature (click-a-step-to-see-wiring) is unusable for keyboard/SR users; sighted users lose hover affordance. Real UX benefit for low effort on a flagship "transparency" page.
- **Fix sketch**: Add a `<title>` child to the `<svg>` (mirrors the aria-label, gives the hover tooltip). On clickable `<g>` nodes add `aria-label={box.label}` (and `role="button"` already present) so each step announces its name. Optionally give the svg `role="group"` + per-node titles when you want the structure exposed rather than flattened to one image.

## 3. "fit" sizing shrinks dense diagrams below the intended 14px text floor in a narrow column — text becomes illegible
- **Lens**: 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: Responsive legibility
- **File**: `app/_components/puml/PlantUml.tsx:565-568` (svg width 100% / maxWidth) · constants.ts:14 (14px floor)
- **Value**: impact 5/10 · effort 3/10 · risk 2/10
- **Scenario**: The two non-featured diagrams render via `<PlantUml scale="natural" expandable />` (page.tsx:118) — good, those scroll. But the component's default `scale="fit"` (and the inline default elsewhere) sets `width:100%; maxWidth:W` with `preserveAspectRatio` meet, so a wide diagram in a narrow content column scales the whole SVG — including the carefully-floored 14px label text — down to whatever the column allows. The constants file explicitly documents a "14px floor = design system text-sm," but `fit` mode silently violates it. There is no minimum-scale guard or a "text too small, expand" hint.
- **Root cause**: `fit` trades legibility for fitting-in-column with no floor; only `natural` (opt-in) preserves text size, and the expand affordance is opt-in (`expandable`) rather than always available when a diagram is scaled below legibility.
- **Impact**: Any caller using the default `fit` (or a future inline architecture diagram in a sidebar/column) renders sub-legible text with no escape hatch. The featured/secondary diagrams dodge it only because the page author hand-picked `natural`.
- **Fix sketch**: When `fit` would scale below ~0.8× (i.e. `containerWidth < W * 0.8`), either clamp the scale and let the figure scroll, or always render the expand button so the user can reach a legible view. Cheapest: make `expandable` default `true` whenever `scale="fit"`.

## 4. Only 3 of 15 committed architecture diagrams are surfaced — `docs/diagrams/03–14` are dead weight the renderer was built to show
- **Lens**: 🚀 Business Visionary
- **Severity**: Medium
- **Category**: Product / content gap
- **File**: `app/diagrams/page.tsx:39` (`DIAGRAMS` array) · `docs/diagrams/*.puml` (15 files committed)
- **Value**: impact 6/10 · effort 2/10 · risk 1/10
- **Scenario**: The repo commits 15 `.puml` architecture sources (domain model, job-ingestion, archetype detection, student intake/transformation/scoring, recruiter outputs, career-switcher, dev-case lifecycle, dev-evaluation model, etc.). The page's `DIAGRAMS` array hard-codes only **3** (`15`, `01`, `02`). The custom renderer — the expensive asset of this whole feature — was built specifically to show these, and a grep confirms nothing else in `app/` references the other 12. They're authored, parse-clean, and invisible.
- **Root cause**: The page curates a static 3-item list rather than enumerating the directory; the other diagrams were authored but never wired into the gallery.
- **Impact**: The page undersells itself as an architecture-transparency / onboarding asset — the richest material (domain model, per-archetype pipelines) is the part not shown. For an AI-hiring SaaS pitching "transparency," surfacing the full set is a near-free credibility/onboarding win. This makes the page a real asset rather than a 3-diagram teaser.
- **Fix sketch**: Read `docs/diagrams/*.puml` via `readdir` server-side and render all (with the curated blurbs as an override map, defaulting to the filename). Group by theme (system / per-archetype / dev-case) so 15 diagrams stay navigable. Low effort, ties directly to the page's stated purpose.

## 5. A `note` with no terminator and no blank line silently truncates the diagram (note absorbs trailing content) — only the fallback path warns
- **Lens**: 🐛 Bug Hunter
- **Severity**: Low
- **Category**: Parser robustness / silent failure
- **File**: `app/_components/puml/parse.ts:399-418` (multi-line note fallback)
- **Value**: impact 3/10 · effort 3/10 · risk 3/10
- **Scenario**: An author writes a multi-line `note … of x` and forgets `end note`, with the following nodes running straight into the closing `}`/`@enduml` with **no blank-line section break**. The code's documented fallback (lines 405-417) then treats it as a single-line note with an *empty* body and consumes nothing — which is the safe choice for *structure* (following nodes still parse) but means the note's intended text is silently dropped and the author gets **no signal at all** (the dev `unresolvedEndpoints` warning only covers edge typos, not malformed notes). The diagram renders "successfully" but wrong.
- **Root cause**: The note terminator scan has a thoughtful three-way fallback, but the no-terminator/no-blank-line branch discards the body with zero diagnostic — there's no dev-mode warning for "note was never closed."
- **Impact**: Low (committed sources are test-pinned and well-formed; this only bites future hand-authoring), but it's a confidently-wrong render with no console signal — the same class of silent-truncation the surrounding comment says was deliberately avoided for the EOF case.
- **Fix sketch**: In the no-`end note` branches, push a message onto a `diagram.warnings[]` array (or reuse the unresolved-endpoint dev-warn channel) so an unterminated note logs in dev like a mistyped alias does, instead of vanishing. Pin with one `parse.test.ts` case asserting the warning fires.
