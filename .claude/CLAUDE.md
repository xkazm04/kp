# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

kp - Add your project description here.

## Common Commands

### Development
```bash
# Add your common development commands here
npm run dev
npm run build
npm run test
```

## Architecture Overview

Add information about your project architecture, key patterns, and conventions.

## Design system — dual theme (read docs/design/README.md before building UI)

The app ships **two themes from one codebase**: **Studio Light** (default —
calm, editorial; for corporate clients) and **Spark Dark** (experimental —
playful, sticker-sheet, derived from the /landing art direction; for creative
users). `[data-theme="dark"]` on `<html>` re-skins everything through the CSS
variables in `app/globals.css`; `ThemeToggle` in the sidebar flips it.

When writing or changing components, always assume **both** themes:

- **Never hardcode colors** (`bg-[#...]`, inline `style` colors, rgba shadows)
  outside `app/landing/` — that directory is a fixed art direction and the only
  exemption. Everything else resolves through tokens.
- Use brand tokens first (`ink`, `paper`, `steel`, `coral`, `moss`,
  `limewash`, `dial-*`, `score-*`), then the theme-remapped neutrals
  (`white`, `stone-50..400`) and the mapped status shades (`red/amber/green/
  blue` — only shades already listed in the `[data-theme="dark"]` block; add
  the dark value when introducing a new one).
- `text-white` means "surface-colored text on an accent background" — it
  flips dark in dark mode by design.
- Compose recurring surfaces from `app/_components/ui/recipes.ts` (PANEL,
  CHIP, BTN_*, EYEBROW, FIELD…) instead of re-typing Tailwind class strings —
  write once, apply multiple times. Behavioral primitives (Modal, Badge,
  SegmentedControl, Skeleton) live in `app/_components/`.
- The themes differ in **structure**, not just color (Spark Dark: drawn
  outlines, sticker shadows, tilt, Bricolage display face, spring easing).
  Express a theme difference at the cheapest layer that holds it: token →
  `dark:` variant in a recipe (the `dark:` variant follows `data-theme`, not
  the OS) → markup fork via a CSS-swapped component like `SectionTitle` (or the
  `.theme-light-only` / `.theme-dark-only` utilities in `app/globals.css`) →
  behavioral fork via `useTheme()` (both in `app/_components/ui/`). Never a JS
  fork where CSS suffices.
- Verify new surfaces in both themes before finishing (toggle in the sidebar
  footer).

## Documentation Sync — update the doc in the same change

`docs/` is genre-partitioned and each feature area owns a folder. Read
[`docs/README.md`](../docs/README.md) for the full layout; the short version:

| Directory | Holds |
| --- | --- |
| `docs/features/<area>/` | What is implemented today, one folder per feature area |
| `docs/architecture/` | Cross-cutting contracts (LLM layer, persistence, self-hosting, app structure) |
| `docs/design/` | The dual-theme design system — **read before building UI** |
| `docs/development/` | Eval/calibration harnesses and how to run them |
| `docs/product/` | Market, roadmap, enterprise track |
| `docs/concepts/` | Proposals not yet implemented |
| `docs/harness/`, `docs/_archive/` | Dated evidence; superseded material. Do not treat as current |

**The rule: when you change behavior, update the doc that describes it in the same
change.** A feature doc that names a moved file or a renamed stage is worse than no doc —
that drift is exactly why this tree was reorganized (the design doc had been claiming the
wrong `paper` token for weeks; the pipeline spec still used stage names the code dropped).

### Source → doc coupling

[`scripts/docs/feature-doc-map.json`](../scripts/docs/feature-doc-map.json) maps source
globs to the doc that documents them — e.g. `app/_lib/comms*.ts` + `app/api/comms/**` →
`docs/features/comms/README.md`, `app/_lib/voice/**` + `app/api/interview/**` →
`docs/features/interviews/README.md`.

When you add a feature area, add its entry to that file **in the same change**, or nothing
will watch it.

### The Stop hook

`.claude/settings.json` registers a Stop hook running
`node scripts/docs/check-doc-sync.mjs` before each turn ends. It walks the turn's
transcript for `Edit`/`Write`/`MultiEdit`/`NotebookEdit` calls, drops skip patterns (tests,
generated code, `.claude/`, `app/landing/`, docs themselves), matches the rest against the
map, and **exits 2 naming the affected doc(s)** when mapped source changed and no file
under `docs/features/`, `docs/architecture/`, or `docs/design/` was touched.

When you see the reminder, **either** update the named doc in that turn, **or** reply with
one short sentence — `"internal-only, no doc update needed"` — explaining why. Do not
ignore it silently. The dismiss path is the deliberate trade-off for catching drift
per-session instead of via periodic cleanups.

The hook honors `stop_hook_active`, so it cannot loop. Fixtures:
`node scripts/docs/__tests__/check-doc-sync.test.mjs` (19 checks, no deps) — they also
validate the map itself: every mapped doc must exist and every glob root must resolve.

### Writing a feature doc

Entry points → user flows → API/lib surface table → data model → a **short** Known gaps
section. Cite real paths and verify they exist. State tier/env/dev-flag gating explicitly,
and describe keyless behavior — degrading without API keys is a product property here.
Anything future-looking belongs in `docs/concepts/` or `docs/BACKLOG.md`, not in a feature
doc.

## Important Conventions

Document your coding standards, naming conventions, and best practices.

<!-- vibeman:context-map:start -->
## Context Map

This project has a machine-readable context map at `context-map.json` (repo root, generated by Vibeman). It maps every source file to a feature ("context"), grouped by business domain. **Before editing code, read `context-map.json` to find the relevant context and scope your changes to its `filePaths`.** Each context also carries `category`, its group's `domain`, and (when present) `crossRefs`; the `index` array is a one-line-per-context overview.

The map is validated on each export: dangling `filePaths` (files no longer on disk) are pruned from the published map, and the `audit` block reports any remaining drift (`staleContexts`, `missingFiles`, `unresolvedCrossRefs`) alongside a git `provenance` stamp so you can judge staleness against the current commit — so treat a resolving reference as trustworthy. Regenerate from Vibeman rather than hand-editing; a context can be `pinned` to survive a full rebuild.
<!-- vibeman:context-map:end -->
