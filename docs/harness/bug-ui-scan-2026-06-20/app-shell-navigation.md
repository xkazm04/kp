# App Shell & Navigation — UI Perfectionist scan

> Context: The authenticated workspace shell — tab navigation, command palette, keyboard shortcuts, recents, global search, attention badges, live refresh, and i18n.
> Files reviewed: 14 of 29
> Total: 7 findings — Critical: 1, High: 3, Medium: 2, Low: 1

## 1. Mobile sidebar dumps the entire 6-group nav above content with no disclosure

- **Severity**: Critical
- **Category**: responsiveness / a11y
- **File**: `app/features/Workspace.tsx:107` (and `:114`, the `<aside>`), mirrored in `app/features/WorkspaceNav.tsx:30`
- **Scenario**: A recruiter opens the workspace on a phone (or narrow viewport `< md`). The layout is `md:flex`, so below `md` the `<aside>` stacks ON TOP of `<main>` and renders in full: brand block, command-palette trigger, recents, **all 6 nav groups (~16 tab buttons)**, language switcher, theme toggle, sign-out. There is no hamburger, no `aria-expanded` disclosure, no collapse.
- **Root cause**: The sidebar was designed desktop-first as a permanent rail; the only responsive rule is `md:` visibility of the flex direction. No mobile pattern (off-canvas drawer / collapsible accordion / bottom tab bar) was ever added — confirmed: the sole `sr-only`/focus token in the file is the skip-link, and there is no `md:hidden` toggle.
- **Impact**: On mobile the user must scroll past a full screen-height of navigation chrome before reaching ANY tab content on every page load. The default Pipeline board is effectively below the fold. This is the highest-leverage surface in the app (every page), so the defect multiplies across the product and makes the studio close to unusable on a handset.
- **Fix sketch**: Add a mobile top bar (brand + hamburger) with the `<aside>` becoming an off-canvas drawer toggled by an `aria-expanded` button, `md:` restoring the static rail. Trap focus in the open drawer and close it on tab select. Reuse the existing `Modal`/portal focus-trap machinery rather than hand-rolling.

## 2. Skip-link target works in `Workspace` but the server `WorkspaceShell` has no skip-link and no focusable main

- **Severity**: High
- **Category**: a11y
- **File**: `app/features/WorkspaceNav.tsx:113` (`WorkspaceShell`), contrast with `app/features/Workspace.tsx:108`–`:113` + `:211`
- **Scenario**: A keyboard/screen-reader user lands on a server-rendered deep-link page (`/jds/[slug]`, `/history/[slug]`) that uses `WorkspaceShell`. They Tab from the top and must walk through the entire sidebar (brand link, recents, every nav Link) before reaching content — there is no "skip to content" link, and the `<main>` (`:117`) has neither `id="main"` nor `tabIndex={-1}`.
- **Root cause**: The skip-link + focusable `<main id="main" tabIndex={-1}>` pattern lives only in the interactive `Workspace`; `WorkspaceShell` was written as a thin layout twin and never received the same a11y affordances even though it carries the identical nav.
- **Impact**: Every server detail page forces keyboard users through ~16 nav links on each visit, and the skip-link parity between the two shells is broken — an inconsistency that is also a WCAG 2.4.1 (Bypass Blocks) gap.
- **Fix sketch**: Extract the skip-link + `<main id="main" tabIndex={-1}>` into the shared shell, or add both to `WorkspaceShell`. Translate the label via the same `nav.skipToContent` key already used in `Workspace`.

## 3. Route/tab change never moves focus or scroll position — SPA navigation is invisible to AT

- **Severity**: High
- **Category**: a11y / focus-management
- **File**: `app/features/Workspace.tsx:97`–`:102` (`selectTab` → `router.replace(..., { scroll: false })`), `:211` (`<main>`), `:217`–`:218`
- **Scenario**: A user activates a tab (sidebar click, `g`-chord, palette, or badge slice link). `router.replace` swaps the `key={navActive}` subtree, but focus stays on the just-clicked sidebar button and the viewport does not scroll. A screen-reader user gets no announcement that the main region changed; a keyboard user's focus is still in the nav, not the new content.
- **Root cause**: Tab switching is pure query-param state with `scroll: false` and no post-navigation focus handoff. There is a focusable `<main id="main" tabIndex={-1}>`, but nothing ever calls `.focus()` on it after a switch, and there is no `aria-live`/`role="status"` region announcing the active tab.
- **Impact**: Disorienting non-visual navigation and a "where did my focus go" problem for keyboard users on the app's most frequent interaction. Also a layout/CLS concern: a long previous tab leaves the user scrolled mid-page when the short new tab mounts.
- **Fix sketch**: On `navActive` change, move focus to `#main` (e.g. an effect keyed on `navActive` calling `mainRef.current?.focus()`), optionally `scrollTo(0,0)`, and add a visually-hidden `aria-live="polite"` region announcing the active tab label.

## 4. Active-state pill relies on a `bg-coral` dot + color text only; `aria-current` is correct but the visual cue fails contrast/colorblind users

- **Severity**: Medium
- **Category**: a11y / visual-hierarchy
- **File**: `app/features/Workspace.tsx:168`–`:172` (dot + `navItemClass`), `app/features/tabs.ts:170`–`:172`
- **Scenario**: A user scanning the sidebar distinguishes the active tab solely by (a) a 6px coral dot vs. a stone dot and (b) coral text on a `coral/10` wash. `aria-current="page"` is correctly set (good), but the *visual* differentiation is a hue swap with no weight/shape/indicator change.
- **Root cause**: Active treatment is encoded only in color (`navItemClass` returns `bg-coral/10 text-coral` vs `text-steel`), violating "don't rely on color alone." The 1.5px dot is too small to read as a state.
- **Impact**: Colorblind users and anyone in bright light can struggle to tell which tab is active — a sustained low-grade orientation cost on the primary nav.
- **Fix sketch**: Add a non-color active cue: a left border/rail accent (`border-l-2 border-coral`) or bolder font-weight on the active row, in `navItemClass`, so both sidebars inherit it.

## 5. Attention badge is a button nested in (or sibling of) a button with overlapping, near-duplicate labels — confusing AT and keyboard order

- **Severity**: Medium
- **Category**: a11y / interaction-correctness
- **File**: `app/features/Workspace.tsx:160`–`:192` (the `badgeSliceHref` sibling button)
- **Scenario**: For a badged item with `badgeParams` (e.g. Pipeline → aging), the row renders TWO interactive controls: the main tab button (label e.g. "Pipeline") and an absolutely-positioned badge button overlaying its right edge, labeled `attentionBadgeGo` ("Go to N…"). Tab order hits both; a screen-reader user hears two adjacent controls for one visual row, the second one floating over the first's padding (`pr-10`).
- **Root cause**: A button can't nest interactive content, so the badge was lifted to a sibling and absolutely positioned. The result is a visually-merged-but-logically-split pair with similar accessible names and an overlap that is easy to mis-tap on touch.
- **Impact**: Ambiguous activation target (does clicking the badge open the tab or the slice?), awkward keyboard traversal, and a touch hit-area collision on the most-used nav item.
- **Fix sketch**: Make the whole row a single `<Link>`/button to the slice when a slice exists (the bare tab is reachable elsewhere), OR visually separate the badge into its own column with clear spacing and a distinct, non-overlapping label. Ensure the touch targets don't overlap.

## 6. Command palette has no loading state during the debounced search — results flash stale or appear frozen

- **Severity**: Medium
- **Category**: missing-loading-state / polish
- **File**: `app/features/CommandPalette.tsx:118`–`:143` (fetch effect), `:273`–`:304` (results list)
- **Scenario**: A user types a 3+ char query. For the 200ms debounce + network round-trip, the list keeps showing the PREVIOUS query's hits (tab actions stay, but entity hits from the prior term linger), then snaps to the new set. There is no spinner, "Searching…" row, or dimming.
- **Root cause**: `hits` is only replaced on success; nothing tracks an in-flight request to render a pending affordance. Empty state shows `noResults`/`empty`, never "loading."
- **Impact**: On a slow connection the palette looks broken or shows misleading stale matches for the just-typed query, undermining trust in the app's primary search surface.
- **Fix sketch**: Track a `loading` boolean set when the debounced fetch starts and cleared on settle/abort; render a subtle "Searching…" row (or skeleton) under the input while `loading && query.length >= 2`.

## 7. `g`-chord mnemonics are derived first-letter-wins, producing unintuitive keys with no visibility until `?`

- **Severity**: Low
- **Category**: interaction-correctness / discoverability
- **File**: `app/features/KeyboardShortcuts.tsx:25`–`:36` (`deriveChords`)
- **Scenario**: Chords take each tab's first not-yet-taken letter in NAV_GROUPS order. So Profile becomes `g r` (p/o/i taken), Match `g a`→ actually `g m`? — the derivation is order-dependent and opaque: `g d` is Decisions not Dev, Channels `g c` steals `c` so later tabs degrade to odd letters. The mapping is invisible unless the user opens the `?` overlay.
- **Root cause**: Deterministic-but-arbitrary letter assignment optimizes for "every tab gets a free chord" over "the chord is guessable." No persistent hint (e.g. an underlined letter in the sidebar label) surfaces the binding.
- **Impact**: Power-user shortcuts are hard to learn/recall; users fall back to the slower sidebar round-trip the feature exists to avoid. Low blast radius (purely additive), but it undercuts the feature's value.
- **Fix sketch**: Curate a small explicit mnemonic map for the high-frequency tabs (p/c/d/s/j) and let derivation fill the rest, and surface the active letter inline (e.g. underline it in the nav label or show a faint `g·r` hint on hover) so the binding is discoverable without the overlay.
