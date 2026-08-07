# Architecture Diagrams — bug-hunter + ui-perfectionist scan

> Context: The interactive pipeline/architecture diagrams page and the custom PlantUML-style Markdown renderer (elkjs layout) that draws component diagrams as styled SVG.
> Files reviewed: 9 of 10 (+ next.config.ts, Dockerfile, docs/diagrams/15-automated-pipeline-tobe.puml for grounding)
> Total: 5

## 1. `docs/diagrams/*.puml` is read from disk at runtime but never shipped into the standalone image — the whole page is dead in production

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: `app/diagrams/page.tsx:27-41` (read), `next.config.ts:` `output: "standalone"`, `Dockerfile:87-93`
- **Scenario**: Anyone opens the Architecture ("about") tab in the self-hosted Docker image the repo is built for. `readDiagramSource` calls `readFileSync(join(process.cwd(), "docs", "diagrams", file))`. The Dockerfile runner stage copies `.next/standalone`, `.next/static`, `public`, `pipeline`, and `data` — but **not** `docs/`. Next.js file-tracing can't resolve `process.cwd()` + a runtime filename, so `docs/` is never traced in either. `readFileSync` throws ENOENT, the bare `catch` returns `""`, and every one of the three diagrams renders `Could not read {file}.` — silently, with no log.
- **Root cause**: The page treats `docs/diagrams/*.puml` as a runtime asset ("committed build artifacts … in production they never change"), but `output: "standalone"` only ships statically-traceable dependencies. A dynamically-read, non-imported directory is invisible to the trace and absent from the runner. The `catch {}` converts the whole-feature outage into an indistinguishable "file missing" message.
- **Impact**: The entire Architecture Diagrams feature is 100% non-functional in the documented production deployment; a marketing/architecture showcase shows three error boxes. Reproducible on every Docker build; masked in `next dev` (source tree present) so it never shows locally.
- **Fix sketch**: Add `outputFileTracingIncludes: { "/diagrams": ["./docs/diagrams/**"] }` in next.config.ts (or `COPY --from=builder /app/docs ./docs` in the runner stage). Better: `import` the `.puml` sources as build-time modules (or embed them in a generated `.ts`) so they're bundled and the on-disk read — and the whole "missing in prod" class — disappears.

## 2. The diagram body text ("how it's ACTUALLY wired") is unvalidated free text; the contract test only guards `files[]` + alias 1:1

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation-gap
- **File**: `app/diagrams/pipelineSteps.ts:16-260` (the `puml` bodies), `app/diagrams/pipelineSteps.test.ts:40-83`
- **Scenario**: A developer renames `actOnPipelineEntry`, moves `POST /api/jobs/ingest`, or drops the `instrumentation.ts` 60s heartbeat. The `pipelineSteps.test.ts` guard checks that every `STEP_DETAILS.files[]` path exists on disk and that funnel-node aliases match `STEP_DETAILS` keys 1:1 — both stay green. But the boxes users read (`[actOnPipelineEntry]`, `[POST /api/jobs/ingest]`, `[instrumentation.ts\n60s heartbeat]`, `database "pipeline_entries · gemini_cache"`, the phase names) are plain strings inside the `puml` fields and in `15-automated-pipeline-tobe.puml` — **nothing checks they still reflect real code**. (I verified all `files[]` entries and the routes/modules named in the bodies currently resolve — so this is a latent-drift risk today, not a live error.)
- **Root cause**: The freshness guard validates the *citations* (`files[]`) and the *click contract* (alias↔detail), but not the *claims* — the function names, route methods, table names and step statuses drawn in the SVG. The page's whole promise ("this is how it's ACTUALLY wired") rests on exactly the strings that are untested.
- **Impact**: A rename or re-route silently turns the authoritative architecture picture into misinformation for anyone onboarding, with a fully green CI. This is the same one-directional/maskable weakness the sibling Pipeline-Test-Suite agent filed for the Python `test_pipeline_diagram_contract.py`, surfacing here on the TypeScript side.
- **Fix sketch**: Extend `pipelineSteps.test.ts` to parse each body's bracketed tokens that *look* like routes (`/api/...`), function names, or module paths and assert they resolve (grep the route tree / exported symbols), so a stale body fails CI the way a dead `files[]` entry already does.

## 3. Page chrome, legend, explorer copy and status labels are hardcoded English in a 4-locale (en/cs/de/fr) next-intl app

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: visual-consistency
- **File**: `app/diagrams/page.tsx:98-116` (header/blurbs), `:66-88` (`Legend`), `app/diagrams/PipelineExplorer.tsx:23-25` (instructions), `:9-13` (`STATUS_META` "Automated"/"Human gate"/"To build")
- **Scenario**: A Czech/German/French operator (the app resolves locale per-request via `i18n/request.ts`) opens the Architecture tab. Every UI string — "Architecture", "System diagrams", the legend swatches ("live / automated", "human gate (kept by design)", "remaining gap"), "Click any step to see how it's wired", and the drawer status pills — renders in English only. This page is not under the `sub_dev` (Dev Studio) English-only exception.
- **Root cause**: None of these strings go through `next-intl` / `messages/*.json`; they're literals in JSX. (The diagram *bodies* are code identifiers that legitimately don't translate — this finding is scoped to the translatable chrome/legend/instructions/status labels that wrap them.)
- **Impact**: A localized product presents an all-English architecture page to 3 of 4 audiences; the legend that decodes the moss/coral/dashed colour semantics is unreadable to a non-English user, so the diagram's meaning is lost.
- **Fix sketch**: Move the header, blurbs, `Legend` labels, `PipelineExplorer` instruction line, and `STATUS_META` labels into `messages/{en,cs,de,fr}.json` and read them via `useTranslations`/`getTranslations`; `scripts/i18n-check.mjs` already enforces key parity.

## 4. [STILL-OPEN] Clickable diagram nodes expose no accessible name or state, inside a `role="img"` SVG

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: a11y
- **File**: `app/_components/puml/PlantUml.tsx:176-189` (clickProps), `:573-576` (`role="img"` parent)
- **Scenario**: A screen-reader user tabs onto a funnel step. Prior scan (2026-06-20 #6) flagged this; the code is unchanged — still genuinely open, and it still matters because the funnel is the page's only interactive surface.
- **Root cause**: Each clickable shape gets `role="button"` + `tabIndex={0}` + Enter/Space handlers but **no `aria-label`**, so its only name is the multi-line `<text>` tspans (fragments like "Match · KO · score"). Worse, the parent `<svg>` is `role="img"` with its own `aria-label`, which collapses descendants to a single image in many AT — so the buttons may be neither named nor exposed. The `active` state is purely visual (`.puml-active` coral stroke); there is no `aria-pressed`/`aria-expanded` to signal a node opens/owns the detail drawer.
- **Impact**: SR users get an unlabeled or invisible "button" with no signal that activating it opens a panel or which step is currently open — the coral-border affordance has no programmatic equivalent.
- **Fix sketch**: Add `aria-label={box.label.replace(/\n/g,' ')}` and `aria-expanded`/`aria-pressed={active}` to clickable nodes; switch the interactive SVG's `role="img"` to `role="group"` (or `role="application"`) so child buttons are reliably surfaced.

## 5. StepDrawer has no `key` and a mount-only focus effect: switching steps while open swaps content silently

- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state
- **File**: `app/diagrams/PipelineExplorer.tsx:49` (unkeyed `<StepDrawer>`), `:54-58` + `app/_components/useDialogA11y.ts:73-127` (effect deps `[]`)
- **Scenario**: The drawer is deliberately non-modal so the funnel stays clickable. A user with the drawer open clicks a *different* step. `active` updates A→B, but `<StepDrawer detail={active.detail} …/>` has no `key`, so React reuses the instance; `useDialogA11y`'s focus-in effect runs only on mount (`[]` deps) and never re-fires. The heading + inner diagram swap, but focus stays where it was (possibly on the SVG node behind the panel), the drawer isn't scrolled back to top, and SR users hear no "content changed".
- **Root cause**: The "keep the funnel live so you can hop between steps" design has no per-step remount, so nothing re-runs the open-time affordances (move focus in, reset scroll, announce) when the step changes underneath a persistent drawer.
- **Impact**: Minor disorientation and a lost a11y announcement on step-switch — a real but low-frequency UX gap on the page's core interaction.
- **Fix sketch**: Add `key={active.id}` to `<StepDrawer>` so each step is a fresh mount (re-running focus-in/scroll-reset), or move an `aria-live` region + `ref.current?.scrollTo(0,0)` into an effect keyed on `detail.title`.
