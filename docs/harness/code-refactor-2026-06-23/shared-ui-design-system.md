> Total: 7 findings (0c critical, 2h high, 3m medium, 2l low)

## 1. Dead shared component: `ThemeSplit` + its entire CSS mechanism
- **Severity**: High
- **Category**: dead-code
- **File**: app/_components/ui/ThemeSplit.tsx:16 (+ app/globals.css:253-263)
- **Scenario**: `ThemeSplit` is a documented design-system primitive (two-version theme rendering) but has ZERO importers. `grep -rn "ThemeSplit" app` returns only its own definition plus two prose mentions in comments (SectionTitle.tsx:9, useTheme.ts:8) — no `import`, no JSX usage. Its rendering relies on the `.theme-light-only` / `.theme-dark-only` CSS classes, and `grep -rn "theme-light-only\|theme-dark-only"` shows those classes are referenced ONLY by ThemeSplit.tsx — so the four globals.css rules (lines 253-263) plus the explanatory comment block above them are dead in lockstep with the component.
- **Root cause**: A primitive built for a "markup genuinely forks between themes" case that the codebase never actually hit — every theme fork in practice is handled by `dark:` utilities (the recipes) or by branching on `useTheme()` in a client component (FactorChart). ThemeSplit was the aspirational third option that no surface needed.
- **Impact**: A shared-UI file + 4 CSS rules carry zero value but read as live API; new contributors may reach for it (it's still pitched in adjacent comments), and the dead CSS classes are noise in the most heavily-shared stylesheet.
- **Fix sketch**: Delete `app/_components/ui/ThemeSplit.tsx`, the `.theme-*-only` rules + comment in globals.css (248-263), and the two stale prose references in SectionTitle.tsx:9 / useTheme.ts:8. Keep `useTheme()` (still used by FactorChart/ThemeToggle).

## 2. Dead shared component: `DisclosureRow`
- **Severity**: High
- **Category**: dead-code
- **File**: app/_components/DisclosureRow.tsx:11
- **Scenario**: `grep -rn "DisclosureRow" app --include="*.tsx" --include="*.ts"` returns exactly ONE line — its own `export function DisclosureRow(` at line 11. No importer anywhere. It's a non-trivial (~65 line) accessible expandable-table-row primitive (role=button, Enter/Space, aria-expanded, animated detail row) with no consumers.
- **Root cause**: Built as a reusable a11y disclosure for expandable tables, but every expandable table in the workspace rolls its own pattern instead of adopting it (no migration ever happened).
- **Impact**: ~65 lines of "live-looking" shared a11y code that is in fact dead. Worse than mere clutter: because it's unused, the expandable tables that *should* share it have likely drifted to inconsistent (and possibly less-accessible) hand-rolled versions — the dead primitive masks that fragmentation.
- **Fix sketch**: Either delete `DisclosureRow.tsx`, or (higher value) confirm the actual expandable-table call sites and migrate them onto it so the keyboard/aria behavior is shared. Default to deletion unless a migration is planned.

## 3. Dead wrappers + token chains in `Badge.tsx`: `ProvenanceBadge` / `RecommendationBadge`
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/_components/Badge.tsx:259 (ProvenanceBadge), :268 (RecommendationBadge)
- **Scenario**: Badge.tsx is the most-imported shared component (26 importers), but two of its public wrapper components are dead. `grep -rn "ProvenanceBadge" app` (excluding Badge.tsx) → 0; `grep -rn "\bRecommendationBadge\b"` excluding `Interview` → 0. Their backing token mappers are dead in the same chain: `grep -rn "provenanceToken"` and `grep -rn "recommendationToken"` (excluding Badge.tsx) both return nothing — so `provenanceToken` (lines 140-149) and `recommendationToken` (197-206) are reachable only from these dead wrappers.
- **Root cause**: Provenance/recommendation badges were built for surfaces (extractor provenance chips, ExtractionQuality.recommendation prose) that were later re-worked to render differently or dropped, leaving the helpers stranded.
- **Impact**: ~50 dead lines in the highest-traffic shared file; the dead exports (`ProvenanceBadge`, `RecommendationBadge`, `provenanceToken`, `recommendationToken`) are part of the design-system surface area people scan when choosing a badge, so they add real cognitive cost.
- **Fix sketch**: Delete the two wrappers and their two token mappers. Check whether `Cpu`/`Info`/`FileText` lucide imports become unused after removal and prune them too.

## 4. `ScoreBar` re-implements the `Meter` animated-bar primitive
- **Severity**: Medium
- **Category**: duplication
- **File**: app/features/sub_dev/ScoreBar.tsx:13 (vs app/_components/Meter.tsx:12)
- **Scenario**: `ScoreBar` hand-rolls the exact animated-progressbar core that `Meter` owns: `role="progressbar"` + valuemin/now/max, an `useEffect(requestAnimationFrame → setFilled)` grow-from-0-on-mount, the identical `transition-[width] duration-700 ease-out motion-reduce:transition-none` class, and the same `scoreToneColor(scoreTone(score))` fill. `grep -rln 'role="progressbar"'` shows three non-Meter sites; the other two (AnalyticsTab funnel bars, BillingTab usage meter) are genuinely different shapes (count bars / non-100 max), but ScoreBar is a true 0-100 score meter that should compose Meter.
- **Root cause**: ScoreBar needs a label+weight%+value layout around the bar, so the author wrapped a fresh bar rather than putting the layout around `<Meter>`. The bar mechanism got copied along with it.
- **Impact**: Two implementations of "the animated score bar" can drift (Meter uses `bg-score-*` Tailwind classes + a `tone` prop and `bg-stone-100` track; ScoreBar uses an inline `--color-score-*` var and a `bg-stone-200` track) — already a subtle track-color inconsistency. A future motion/a11y tweak to Meter won't reach ScoreBar.
- **Fix sketch**: Keep the ScoreBar label/weight/value layout, but render the bar itself via `<Meter value={score} tone={scoreTone(score)} aria-label={...} />`, dropping the duplicated raf/transition/progressbar code. (Note Meter takes `tone`, not a raw color — so the inline-var path collapses cleanly.)

## 5. Aspirational dead exports in `recipes.ts` (7 unused recipe constants)
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/_components/ui/recipes.ts:36 (PANEL_ACCENT), :46 (CARD_PAD), :50 (DIVIDER), :81 (BTN_GHOST), :86 (ICON_STICKER), :102 (CHIP), :105 (CHIP_QUIET)
- **Scenario**: I greped every exported recipe symbol repo-wide excluding recipes.ts itself. Seven have zero consumers: `PANEL_ACCENT`, `CARD_PAD`, `DIVIDER`, `BTN_GHOST`, `ICON_STICKER`, `CHIP`, `CHIP_QUIET` (each `grep -rn "\b<SYM>\b" app ... | grep -v ui/recipes.ts` → empty). The file's own header says migration is "opportunistic" — these recipes were defined ahead of any call site and never got one. (The 18 other recipe exports ARE used, confirmed via the import-statement grep.)
- **Root cause**: The recipe layer was seeded with the full intended catalogue up front; some entries (notably the accent/chrome surfaces and ghost button) never found a consumer.
- **Impact**: Low-risk but real: ~7 of 25 design-system "canonical class strings" are fiction — a consumer who adopts e.g. `CARD_PAD` or `DIVIDER` would be the first, so they don't actually centralize anything yet, and they pad the file people are told to compose from.
- **Fix sketch**: Either delete the 7 unused exports, OR (preferred if the design intends them) wire the obvious call sites — e.g. swap literal `border-t border-stone-200` for `DIVIDER` and literal `p-5` paddings for `CARD_PAD` where they already match. Don't leave them as orphans; pick one direction.

## 6. Dead exports in `brand.ts` and `format.ts` (`DIAL_STONE`, `DIAL_AMBER`, `formatYears`)
- **Severity**: Low
- **Category**: dead-code
- **File**: app/_lib/brand.ts:25-26 (DIAL_STONE, DIAL_AMBER); app/_lib/format.ts:191 (formatYears)
- **Scenario**: `grep -rn "DIAL_STONE\|DIAL_AMBER" app` returns only their definitions in brand.ts — no consumer. `grep -rn "formatYears" app` returns only its definition at format.ts:191 — no consumer, not even a test. (By contrast `scoreComponentSum`, which also looked unused, is consumed internally by `reconcileScoreTotal` + tested, so it is NOT dead.)
- **Root cause**: `DIAL_STONE`/`DIAL_AMBER` are leftover dial color literals from a prior ScoreDial palette (the current dial resolves colors via `scoreToneColor`, not these). `formatYears` is a presentation helper that no surface calls.
- **Impact**: Minor — three unused exports in the shared theme/format libs, which brand.ts explicitly bills as "exactly one place" for JS color mirrors. The dead dial colors specifically invite drift (someone may "keep them in lockstep" with a CSS block that no longer drives anything).
- **Fix sketch**: Delete `DIAL_STONE`, `DIAL_AMBER` from brand.ts and `formatYears` from format.ts. If `formatYears` was intended for a candidate-experience surface, wire it; otherwise drop it.

## 7. `clampFraction` re-declared privately in `skill-profile.ts`
- **Severity**: Low
- **Category**: duplication
- **File**: app/_lib/skill-profile.ts:29 (vs the exported app/_lib/format.ts:123)
- **Scenario**: `format.ts` exports `clampFraction` (the documented "sibling of clampPercent" for the 0..1 domain), but `grep -rn "clampFraction" app` shows the only app consumer is `app/_lib/skill-profile.ts` — which declares its OWN private `function clampFraction(x)` at line 29 and uses it at line 58, instead of importing the shared one. The exported `clampFraction` is therefore reachable only from format.test.ts.
- **Root cause**: skill-profile rolled a local one-liner clamp rather than importing the canonical helper (likely written before/independently of the format.ts seam).
- **Impact**: Tiny but it's exactly the divergence format.ts's "single place every number passes through" contract exists to prevent — and it means the shared `clampFraction` export currently earns its keep only via its own unit test.
- **Fix sketch**: Replace skill-profile.ts's private `clampFraction` (lines 29 + call at 58) with `import { clampFraction } from "@/app/_lib/format"`. (Behavior is identical: `Math.max(0, Math.min(1, x))`.)
