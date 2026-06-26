# Architecture Diagrams — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀2 / 🚀3 | Severity: C0/H3/M2/L0

## 1. Dark capability — only 3 of 15 committed diagrams are ever surfaced
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: dark-capability / value-left-on-table
- **File**: app/diagrams/page.tsx:39
- **Observation**: The page hardcodes a 3-entry `DIAGRAMS` array (`15-automated-pipeline-tobe`, `01-…v1`, `02-…v2`). But `docs/diagrams/` holds **15** render-ready `.puml` sources — domain model (03), job ingestion (05), BAU matching (06), archetype detection (07), the full student journey (08–10), recruiter outputs (11), career switcher (12), dev-case lifecycle (13), dev evaluation model (14). The bespoke parser→elkjs→SVG renderer can already draw every one of them; 12 are simply never listed, so a large hand-authored content corpus is invisible.
- **Why it matters**: This is kp's signature "built-but-unwired" pattern. A genuinely impressive renderer (custom PlantUML subset, ELK layout, design-token SVG, clickable funnel, zoom modal, a11y) was built, yet ~80% of the material it exists to show is dark. The marginal cost of each extra diagram is one array entry.
- **Recommendation**: Replace the hardcoded trio with a curated, labelled list covering all 15 (grouped: "Today's platform" vs "Archetype journeys" vs "Dev-case"), or glob `docs/diagrams/*.puml` with a per-file label map. Reuse the existing non-featured `<PlantUml … expandable>` path.
- **Effort**: S

## 2. Unrecorded decision: `/diagrams` is ungated in prod yet leaks internal file paths
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: undocumented-assumption / info-exposure
- **File**: app/diagrams/page.tsx:12
- **Observation**: The nav link to this page lives only on the dev-only About tab (`ABOUT_TAB_IN_NAV = process.env.NODE_ENV !== "production"`, app/features/tabs.ts:87), signalling "internal only." Yet the route itself has **no auth guard, no `NODE_ENV` gate, and there is no middleware** — `export const dynamic = "force-dynamic"` is the only directive. Anyone who knows the URL reaches it in production, where the drawers print internal module paths (`app/_lib/db.ts (actOnPipelineEntry)`, `pipeline/jobfit/automation.py`, `instrumentation.ts`, …) — see app/diagrams/pipelineSteps.ts:144 and throughout. The public `/about` page deliberately does *not* link here, which only deepens the contradiction.
- **Why it matters**: The intent is genuinely ambiguous: dev-only nav vs publicly-reachable route. Either the gating is incomplete (the page is meant to be internal and is leaking the architecture + source map), or it's meant to be public and the dev-only treatment is wrong. Nobody reading the code can tell which, and the "leak" reading is a real recon gift to an attacker.
- **Recommendation**: Decide and record it. If internal: gate the route (`notFound()` when `NODE_ENV === "production"`, matching the tab). If public: build a sanitized variant (Finding 5) that drops raw file paths. Add a one-line comment stating the intent.
- **Effort**: S

## 3. The "honest gap" prose is hand-maintained and unverified — it will silently rot
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: stale-by-design / false-confidence test
- **File**: app/diagrams/pipelineSteps.ts:85
- **Observation**: Step summaries make precise, decaying factual claims: *"the runtime extractor still calls Gemini (off-spec vs the Claude-CLI-only rule)"* (:85), *"interview slot hardcoded Tue 14:00"* (:185), *"External job-board posting is still manual"* (:51), *"recipient is still the candidate label — an email/ATS field is the enrichment hook"* (:157). The only guard, pipelineSteps.test.ts:40, asserts each `files[]` path **exists** — it never checks these gap claims are still true. The page's whole stated value is "this is how it's ACTUALLY wired" (pipelineSteps.test.ts:2), and the code repeatedly calls the contract "CI-guarded" (PipelineExplorer.tsx:43), which over-promises.
- **Why it matters**: The moment someone wires job-board posting or fixes the Gemini→Claude path, the diagram keeps telling every viewer "still manual / off-spec." On a page sold as the source of truth, stale prose is silent misinformation — worse than no page, because it's trusted.
- **Recommendation**: Either (a) move volatile gap claims behind a single dated `as of <date>` caption and document that they're manually maintained, or (b) make the gaps assertable — e.g. a test that greps the named module for the claimed condition (Gemini call present, hardcoded slot present) and fails when the claim no longer holds.
- **Effort**: M

## 4. A pure-SVG renderer with no export, no deep-link, and no instrumentation
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: feature-gap / analytics
- **File**: app/_components/puml/PlantUml.tsx:492
- **Observation**: `ExpandedDiagram` gives zoom/fit but no "Download SVG/PNG" — even though `DiagramSvg` (PlantUml.tsx:551) emits a clean, self-contained `<svg>` that is trivial to serialize and download. The interactive funnel tracks its open step in local `useState` (PipelineExplorer.tsx:19) with **no URL sync**, so a step view can't be linked or bookmarked. And this page — filed under "Insights, Analytics & Simulation" — fires **zero** analytics: no record of which pipeline steps recruiters open, the one signal that would reveal what buyers are confused by or care about.
- **Why it matters**: For a communication/trust artifact these are the cheap multipliers: an exportable architecture diagram lands in sales decks and RFP responses; a deep-link ("here's our Interview step") is shareable; click telemetry tells product which part of the AI pipeline customers scrutinize most.
- **Recommendation**: Add a "Download SVG" button to the expand modal (serialize the existing SVG node); sync the active funnel step to a `?step=` query param; emit a `diagram_step_opened` event in `onNodeClick`.
- **Effort**: M

## 5. Reposition the page from dev docs into a candidate/buyer responsible-AI trust surface
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: monetization / differentiation
- **File**: app/diagrams/page.tsx:60
- **Observation**: The featured funnel already encodes exactly the story AI-hiring buyers and candidates now demand: the `Legend` (page.tsx:60) and `DIAGRAM_STATUS_TOKENS` trichotomy spell out **what's automated vs where a human decides vs what's not built** (live / human gate / gap), and the screening step explicitly states "early-career and low-confidence are held … never auto-rejected" (pipelineSteps.ts:128). That is a ready-made transparency/fairness narrative (EU AI Act, candidate-facing explainability) — but it's reachable only from a dev-only About tab and seasoned with internal file paths.
- **Why it matters**: Transparency about *where humans gate AI hiring decisions* is a live competitive differentiator and sales/compliance asset, not decoration. The hard part (an accurate, interactive, human-in-the-loop diagram) is already built; it's just pointed at developers instead of customers.
- **Recommendation**: Ship a sanitized public "How our AI hiring pipeline works — and where humans decide" page reusing `PipelineExplorer` with the file-path block stripped (or replaced by plain-English "what happens here"). Link it from `/about` and pricing. Pairs naturally with Finding 4's export (compliance/RFP packet).
- **Effort**: M

---
Notes: read 10/10 in-scope files in full, plus app/diagrams/page.tsx's nav context (app/features/tabs.ts, app/features/sub_about/AboutTab.tsx), `docs/diagrams/` inventory (15 .puml), and confirmed no middleware/route gate exists. The renderer + parser themselves are notably robust (strict-mode typo guard, too-large degrade, layout-failure fallbacks, drift tests) — correctness findings were intentionally not manufactured; the value here is content reach, intent clarity, and positioning.
