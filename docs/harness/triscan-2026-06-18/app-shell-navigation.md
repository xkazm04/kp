# App Shell & Navigation — Tri-Lens Scan
> Total: 5
> Severity: 0 Critical / 1 High / 3 Medium / 1 Low
> Lens: 2 bug / 2 ui / 1 biz

## 1. No mobile/narrow-viewport nav collapse — the full 17-item sidebar stacks above every page
- **Lens**: 🎨 UI Perfectionist (primary) · also 🚀 Business Visionary
- **Severity**: High
- **Category**: Responsive / mobile navigation
- **Value**: impact 8/10 · effort 4/10 · risk 3/10
- **File**: `app/features/Workspace.tsx:101` (and `WorkspaceNav.tsx:28`, `:110`)
- **Scenario**: On a phone/narrow window the layout is `md:flex`, so below `md` the `<aside>` renders in normal flow as a full-width block: brand, command-palette button, Recents, the keyboard-shortcuts island, then all six `NAV_GROUPS` (~17 tab buttons with badges) — every byte of nav — stacked vertically. The actual workspace content (`<main>`) only begins after the entire sidebar, so a recruiter on mobile scrolls past ~20 controls before seeing the Pipeline board. There is no hamburger, no `md:hidden` toggle, no collapse (`grep` for `Menu`/`md:hidden`/`hamburger` in Workspace.tsx → none).
- **Root cause**: The sidebar was designed desktop-first (`md:sticky md:w-64`); the sub-`md` case was never given a collapsed affordance, only a `border-b` to separate it from content.
- **Impact**: Mobile/tablet is effectively unusable for navigation; the command palette (the one mobile-friendly entry point) is itself buried inside the stacked sidebar. Hurts the "productivity shell" value prop on the go.
- **Fix sketch**: Wrap the nav body in a `md:hidden` disclosure: a sticky top bar (brand + palette + a `<button aria-expanded aria-controls>` menu toggle) that reveals the groups in a collapsible panel below `md`; keep the current `md:` sticky sidebar untouched. Share the markup between `Workspace` and `WorkspaceNav` so detail pages get it too.

## 2. `nav.tabs.workspace` translation key missing in BOTH locales → untranslated "Workspace" label
- **Lens**: 🐛 Bug Hunter (primary) · also 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: i18n completeness / missing-key fallback
- **File**: `app/features/tabs.ts:143` (def) vs `messages/en.json:413` & `messages/cs.json:413` (`nav.tabs`)
- **Scenario**: `NAV_GROUPS` Settings group declares `{ id: "workspace", label: "Workspace" }`, but neither `messages/en.json` nor `messages/cs.json` has a `nav.tabs.workspace` entry (verified: keys stop at `models`; `grep "workspace"` across `messages/` → no match). `navLabel` has-fallback returns the baked English `"Workspace"`, so in the Czech UI the sidebar item, the command-palette "Go to" action, and the shortcuts overlay all read English "Workspace" while every sibling tab is translated.
- **Root cause**: The `workspace` tab was added to `NAV_GROUPS` after the catalogs were last filled; the silent has-fallback masked the gap (no build/test guard pins `nav.tabs` ⊇ NAV_GROUPS ids).
- **Impact**: Visible untranslated string in the core shell for cs users; erodes the "full i18n" claim. Will silently recur for the next added tab.
- **Fix sketch**: Add `"workspace"` to `nav.tabs` in `en.json` and `cs.json`. Then add a unit test (alongside `tabs.test.ts`) asserting every `NAV_GROUPS` item id has a `nav.tabs.<id>` key in each locale, turning the next missing key into a red build instead of a quiet English leak.

## 3. Command palette: arrow-key navigation never scrolls the highlighted option into view
- **Lens**: 🎨 UI Perfectionist (primary) · also 🐛 Bug Hunter
- **Severity**: Medium
- **Category**: Command-palette keyboard a11y
- **File**: `app/features/CommandPalette.tsx:222` (`onInputKey`) + `:273` (`max-h-[50vh] overflow-y-auto`)
- **Scenario**: The results `<ul>` caps at `max-h-[50vh]` with `overflow-y-auto`. Arrowing down updates `selected`/`active` and `aria-activedescendant`, and the row restyles to `bg-coral/10` — but nothing calls `scrollIntoView`. With recents + ~17 tab actions + up to 25 search hits, the highlighted item moves below the visible fold and the user arrows "blind": the selection indicator is off-screen and Enter fires on an item they can't see.
- **Root cause**: Selection is pure state/ARIA; the scroll position of the overflow container is never reconciled to the active row.
- **Impact**: Keyboard-only and power users (the palette's core audience) lose visual tracking of the selection — exactly the flow Ctrl/Cmd+K exists to make fast. A combobox a11y expectation (active option visible) is unmet despite correct `aria-activedescendant`.
- **Fix sketch**: On `active` change, `document.getElementById(\`palette-item-${active}\`)?.scrollIntoView({ block: "nearest" })` in a small effect (or ref the option list). `block: "nearest"` avoids jumpiness and is a ~3-line, low-risk addition.

## 4. Global search has no relevance ranking — newest-per-type, capped at 5, with no scoring
- **Lens**: 🚀 Business Visionary (primary)
- **Severity**: Medium
- **Category**: Search quality / discoverability
- **File**: `app/_lib/db/analytics.ts:552` (`searchEntities`) + `CommandPalette.tsx:36` (`HIT_TYPE_ORDER`)
- **Scenario**: Each entity type runs `… LIKE '%q%' ORDER BY created_at DESC LIMIT 5`. Results are ordered by recency-within-type then concatenated in a fixed type order (profile→entry→job→jd→analysis). So searching a candidate's exact name can rank below five newer partial matches of the same type and never surfaces if it's the 6th newest; an exact-prefix or whole-word hit is never preferred over a substring; and no cross-type relevance exists. For a recruiter with hundreds of candidates this quietly hides the thing they searched for.
- **Root cause**: Search was implemented as a cheap multi-table LIKE for a small dataset; "good enough" recency ordering substitutes for relevance.
- **Impact**: Search — the headline navigation/productivity feature — returns plausibly-wrong top hits as data grows, undermining trust in the palette and pushing users back to manual tab hunting.
- **Fix sketch**: Add a lightweight relevance sort: rank exact match > prefix match > word-boundary > substring (a `CASE` expression or post-query scoring on `label`), tie-break by recency, and lift the per-type cap or interleave by score. Keeps the parameterized LIKE (injection already handled via `escapeLike`).

## 5. Attention badges can't distinguish "loading / unavailable" from genuine zero, and there's no roll-up
- **Lens**: 🎨 UI Perfectionist (primary) · also 🚀 Business Visionary
- **Severity**: Low
- **Category**: Attention-badge clarity
- **File**: `app/features/useAttention.ts:17` + `Workspace.tsx:146`
- **Scenario**: `useAttention` starts at `null` and, on any fetch failure, "degrades to the last known counts (or none)" — silently. The renderer only shows a pill when `badge > 0`, so a failed/never-loaded attention poll is visually identical to "nothing needs attention." A recruiter who actually has six queued decisions but whose `/api/attention` quietly failed sees a clean, badge-free sidebar and assumes they're caught up — the exact false-confidence the attention system was built (per `_lib/attention.ts` header) to prevent. There's also no single "N items need your attention" roll-up; the signal only exists per-tab.
- **Root cause**: Badges are intentionally fire-and-forget hints; the design conflates "0" and "unknown," and offers no aggregate entry point.
- **Impact**: Low-frequency but high-consequence: a stale/failed badge state reads as "all clear." Minor missed-productivity surface from the absent roll-up.
- **Fix sketch**: Track a tri-state (`null` loading / counts / stale-after-error) and, when the last poll errored, show a subtle muted dot or `title` on the affected items rather than nothing. Optionally surface a total in the brand header (`Σ decisions+schedule+…`) as a one-glance "needs me" indicator that deep-links to the highest-priority queue.
