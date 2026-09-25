---
paths:
  - "app/**/*.tsx"
  - "app/**/*.css"
---

# UI and style (workspace surfaces)

Reference: **`docs/design/README.md`** (paint, kit), **`docs/design/surface-doctrine.md`** (composition),
**`docs/design/loading-choreography.md`** (waiting). Out of scope: `app/landing/**`, `/about`, `/market`.
**Compose from the kit**: a tool surface is built from `app/_components/kit/` (README "Composition kit":
parts, measure, fold order, density); recipes (`ui/recipes.ts`) paint single elements. A port under
judgement sits behind `useKitFlag()` (`?kit=1`, dev only) and is promoted only with a full feature-parity table.

## The law

- **Two registers, never flattened** (README "The duality"): Studio Light = Fraunces serif, cream,
  hairlines, `rounded-lg`; Spark Dark = Bricolage, drawn 2px outlines, 16px radius, hard sticker
  shadows. Express a difference at the cheapest layer: token, `dark:` recipe, markup fork, `useTheme()`.
- **Both themes, always** (README "Rules for dual-theme components" 1, 6): no literal colour outside
  `app/landing/`; brand tokens (`ink paper coral moss steel`) first; check the surface in both themes.
- **Type tokens, floor 14px** (README "Type & motion"): `text-display 36 / h2 22 / h3 16 / body 16 /
  meta 14 / micro 14`. Nothing below 14px: `text-xs` and `text-[<14px]` are below the floor.
- **Hierarchy by size step and weight; one emphasis per row; never by opacity or smaller type**
  (README "Composition kit"). Absence is "—" with its reason, never 0.
- **Buttons carry height at the call site** (`recipes.ts` BTN_PRIMARY doc; `recipes-sizing.test.ts`
  fails a bare `className={BTN_*}`): `h-9`/`h-10` + `px-4`; touch surfaces `BTN_PRIMARY_LG` (h-11).
- **Radius is a named step, never bare `rounded`**: surfaces `rounded-lg` (dark 16px via recipe or
  `shadow-panel`), controls `rounded-md` (`dark:rounded-lg`), chips `rounded-full` (README; recipes.ts).
- **No skeletons** (loading-choreography law 4): a quiet box named `LoadingGap`. **No `title=` tooltips**
  (surface-doctrine "A tooltip must be a real element"): `Tooltip` or `IconAction`.
- **Planes, not nested boxes; a count is a numeral; no sentence occupies layout** (surface-doctrine 1-3).

## Don't hand-roll

| Need | Use |
|---|---|
| tool surface (kit) | `KitSurface`, `PageHead`, `Section` / `Note`, `ListRow`, `DataTable` / `FlowTable`, `StatStrip`, `KeyValueGrid`, `ReadingPane` |
| kit controls | `Button`, `ChipRow` / `Tag`, `Toolbar` / `Segmented` / `SearchField`, `SettingRow`, `TextField` / `SaveBar`, `Mark` |
| funnel, distribution, journey | kit/graphic `Sieve`, `Skyline`, `StageRail` / `Lane`, `ShapeMark` (only where the data has that shape) |
| panel / sunken / accent / popover | `PANEL`, `PANEL_SUNKEN`, `PANEL_ACCENT`, `POPOVER` (menus are not `PANEL`) |
| page header | `PAGE_HEADER` + `EYEBROW` / `TITLE_DISPLAY` / `INTRO` |
| button | `BTN_PRIMARY` (main action), `BTN_AFFIRM` (positive half of a decision), `BTN_SECONDARY`, `BTN_GHOST` |
| icon-only control | `IconAction` (label = name + tooltip + sr text); rail chrome `railIconBtn` |
| toggle / segmented / tabs | `CHIP_TOGGLE`, `toggleBtn`, `TOGGLE_GROUP`, `SegmentedControl`, `useTablist` |
| chip, stat, label | `CHIP`, `CHIP_QUIET`, `STAT` / `STAT_LABEL` / `STAT_VALUE`, `META_LABEL` |
| advisory strip | `NOTICE(tone)` |
| sticky table head / bar | `STICKY_HEAD(layer)`, `STICKY_BAR(on)`; table parts in `app/_components/table/` |
| field, select, modal, confirm | `FIELD`, `Select`, `Modal`, `ConfirmDialog` · date `useDateFormat()`, gap `LoadingGap` |

## The ratchets (they fail `npm run test:unit`)

`app/_components/ui/style-debt.test.ts` holds nine raw steps per file (`style-debt.json`):
below-floor-text, arbitrary-text-size, raw-text-size, raw-stone-text, raw-status-hue, raw-button,
bare-rounded, literal-page-header, raw-table. Siblings: `recipe-debt.json`, `skeleton-debt.json`,
`loading-gap-debt.json`. Reading a failure: `grew <file> <rule>=N > M` = you added one, fix it;
`undeclared` = a new file or rule hit, compose tokens/recipes instead; `dead-rule` = a matcher broke.
After a real fix: `node --experimental-transform-types app/_components/ui/style-debt.test.ts --tighten`
in the same commit. Never raise a ceiling (ADR 0007). The edit-time hook
(`scripts/style/lint-edited.mjs`) reports the new hits on the file you just edited.
