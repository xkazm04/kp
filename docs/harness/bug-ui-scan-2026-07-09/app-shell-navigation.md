# App Shell & Navigation — bug-hunter + ui-perfectionist scan

> Context: The authenticated workspace shell — two-level rail sidebar, mobile drawer, command palette, keyboard chords, recents, attention badges, live refresh, error/loading boundaries, and i18n.
> Files reviewed: 25 of 57
> Total: 5

## 1. Collapsed mobile nav drawer stays in the tab order & a11y tree; no focus trap when open

- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: a11y
- **File**: `app/features/Workspace.tsx:165-170` (the `<aside>`), `:140-154` (hamburger)
- **Scenario**: On a phone (`< md`) the drawer is hidden with `-translate-x-full`, not `display:none`/`inert`. A keyboard or screen-reader user who never opens the menu still Tabs/swipes through the whole shell — command palette, ~20 nav buttons, language switcher, theme toggle, sign-out — all sitting off-screen to the left. Focusing one yanks the viewport sideways. When the drawer *is* open, `<main>` is not `inert`, so focus leaks behind the scrim (only Escape/scrim-click close it) — no focus trap.
- **Root cause**: Off-canvas hiding via CSS transform leaves the subtree focusable and in the accessibility tree; the brand-new drawer reused the desktop rail markup and never gated visibility per state. `aria-expanded={mobileNavOpen}` on the hamburger therefore lies — the "collapsed" content is fully reachable.
- **Impact**: Every mobile keyboard/AT user hits the entire nav twice and suffers disorienting horizontal focus jumps on the app's most-used surface; WCAG 2.4.3 (Focus Order) gap.
- **Fix sketch**: Below `md`, add `inert`/`aria-hidden` (or unmount) the `<aside>` when `!mobileNavOpen`, and mark `<main>` inert while it's open. Reuse the `Modal` focus-trap machinery for the open drawer so this class of off-canvas defect is handled once.

## 2. Only `selectTab` closes the mobile drawer — badge-slice and palette navigations leave it open

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-corruption
- **File**: `app/features/Workspace.tsx:182` (`onSliceNav`) vs `:108-116` (`selectTab`); `app/features/CommandPalette.tsx:212-221` (`go`)
- **Scenario**: On mobile, open the drawer and tap a badge's "go to N aging" pill, or open the command palette and pick a result. Navigation happens (`router.replace`/`router.push`) but `setMobileNavOpen(false)` is never called on those paths, so the drawer stays parked over the freshly-loaded content and the user must dismiss it by hand.
- **Root cause**: Drawer-close is wired only into the sidebar tab handler, not modeled as "any in-shell navigation closes the drawer." The badge second-target and the palette `go()` (which has no access to `mobileNavOpen`) are separate navigation entry points that were missed.
- **Impact**: Confusing dead-end on mobile after the two "power" navigation shortcuts; content appears not to have changed until the user closes the drawer.
- **Fix sketch**: Close the drawer centrally — e.g. an effect that runs `setMobileNavOpen(false)` on `search`/pathname change — so every present and future navigation path clears it, not just `selectTab`.

## 3. Command palette arrow-key navigation never scrolls the active option into view

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: a11y
- **File**: `app/features/CommandPalette.tsx:223-234` (`onInputKey`), `:273-299` (results list, `max-h-[50vh] overflow-y-auto`)
- **Scenario**: Type a query that returns many hits (recents + all tab actions + entity results easily exceed the 50vh list). Press ArrowDown repeatedly: `selected` advances and the highlight/`aria-activedescendant` move, but the highlighted `<button>` is never scrolled into the scroll container — the active row slides out of sight while the user keeps pressing down "into nothing."
- **Root cause**: Keyboard selection updates state and ARIA but nothing calls `scrollIntoView({ block: "nearest" })` on the active option; `aria-activedescendant` alone doesn't scroll the listbox.
- **Impact**: Keyboard and screen-magnifier users lose the highlighted item; the primary search surface is effectively unusable past the first ~8 rows without a mouse.
- **Fix sketch**: Keep a ref to the active `<li>`/button (or query `#palette-item-${active}`) and `scrollIntoView({ block: "nearest" })` in an effect keyed on `active`. Bake it into the list so every future palette variant inherits it.

## 4. [STILL-OPEN] Command palette shows no loading state; prior query's results linger during the debounced fetch

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state
- **File**: `app/features/CommandPalette.tsx:119-144` (debounced fetch), `:272`, `:300-304` (results/empty)
- **Scenario**: Type "jo" → hits for "jo" render; keep typing "john". For the 200ms debounce + round-trip, `hits` still holds the "jo" results (only replaced on success), so the user sees stale matches for a query they've already changed, then a silent snap. There is an `error` line but no pending affordance. (Prior 2026-06-20 report #6; still present — `loading` was never added.)
- **Root cause**: No in-flight flag is tracked; the empty branch only distinguishes `noResults` vs `empty`, never "searching."
- **Impact**: On a slow link the palette looks frozen or shows misleading stale hits for the just-typed term, undermining trust in the app's main search.
- **Fix sketch**: Add a `loading` boolean set when the debounced fetch starts and cleared on settle/abort; render a "Searching…" row (or dim the list) while `loading && query.trim().length >= 2`.

## 5. First-level rail group labels render at 10.5px — too small for primary wayfinding

- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: visual-consistency
- **File**: `app/features/nav/SectionRailNav.tsx:89` (`text-[10.5px] font-semibold`), rail `:97` (`w-16`)
- **Scenario**: The brand-new icon rail is the *only* first-level navigation; each group is an icon plus a `text-[10.5px]` label ("Hiring", "Insights", "Settings", …). At 10.5px on a 64px rail these labels are hard to read and sit well below the rest of the type scale (panel items are `text-base`), so the top level of the nav is the hardest thing to scan.
- **Root cause**: An arbitrary sub-scale pixel value was chosen to fit two lines under a 20px icon in a 64px rail, rather than widening the rail or shortening labels to fit a token-sized class.
- **Impact**: Low-grade but constant readability cost on the primary nav, and a drift from the design system's type tokens.
- **Fix sketch**: Widen the rail slightly (e.g. `w-[4.75rem]`) and lift labels to a real token step (`text-[11px]`/`text-xs`), or drop to icon-only with the label in a `title`/tooltip; standardize via a rail-label recipe so it can't re-drift.
