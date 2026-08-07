> Total: 6 findings (0c critical, 1h high, 2m medium, 3l low)

This context is unusually clean for a shell: a single source-of-truth tab catalog (`tabs.ts`) feeds the sidebar, command palette, keyboard chords, deep-link pages and search; helpers (`navLabel`, `buildTabSwitchUrl`, `clearedTabScopedParams`) are genuinely shared; i18n-check passes with 2877 keys in full en/cs parity (no orphan keys); and there are no console.logs, commented-out code, or stale TODO/HACK markers in any scope file. The two `eslint-disable` lines are narrowly scoped and justified. The findings below are the real opportunities, highest value first.

## 1. The grouped nav-render block is copy-pasted between Workspace.tsx and WorkspaceNav.tsx
- **Severity**: High
- **Category**: duplication
- **File**: app/features/Workspace.tsx:186-248 and app/features/WorkspaceNav.tsx:45-98
- **Scenario**: Both shells iterate `NAV_GROUPS.map((group, gi) => …)` and render a near-identical ~50-line block: the same group-header markup (`px-2 pb-1 text-sm font-semibold uppercase tracking-[0.12em] text-steel/70`), the same `badge = item.badgeKey && attention ? attention[item.badgeKey] : 0` logic, the same `badgeSliceHref` computation, the same `navItemClass`/`pr-10` row styling, the same dot+truncate+badge layout, and the same badge-slice second target. Confirmed by grep: `const navText = (key, fallback) => navLabel(t, key, fallback)` is declared verbatim in BOTH files (Workspace.tsx:83, WorkspaceNav.tsx:28), `badgeSliceHref` appears 12 times across the two, and both `NAV_GROUPS.map((group, gi) =>` loops are byte-identical in structure. The ONLY real difference is the leaf interactive element: client `<button onClick={selectTab}>` vs server `<Link href={tabHref}>`.
- **Root cause**: When `WorkspaceNav` was added for server-rendered deep-link pages, the interactive sidebar's render was duplicated rather than factored into a shared presentational piece parameterized over the row renderer.
- **Impact**: Every nav/badge tweak must land in two places (the inline comments at Workspace.tsx:197 and WorkspaceNav.tsx:57 even say "Mirror of Workspace.tsx" / "same as Workspace.tsx" — an explicit acknowledgement of the drift risk). The active-state divergence the code already once suffered (coral-wash vs ink-pill, fixed via `navItemClass`) is exactly the class of bug this duplication keeps inviting: a future change to badge markup or group spacing applied to one sidebar but not the other.
- **Fix sketch**: Extract a `NavGroups` presentational component (or a `renderNavGroups(group, renderRow)` helper) in `tabs.ts`/a sibling that owns the group header + badge + slice-link layout, taking a `renderRow(item, { isActive, badge, badgeSliceHref })` render-prop so the client passes a button and the server passes a Link. `navText` and the badge math move inside it. Both shells shrink by ~40 lines and can never drift again.

## 2. `readRecents` is exported but has zero external callers
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/features/recents.ts:30
- **Scenario**: `export function readRecents()` is consumed only inside `recents.ts` itself (by `recordRecent` at line 53 and `useRecents` at lines 69-70). Grep across the whole repo for external usage: `readRecents` → 0 external files, while its siblings `recordRecent` → 3, `useRecents` → 2, `RecentItem` → 1. So the `export` is a public surface nobody imports.
- **Root cause**: Likely exported speculatively (or for a since-removed consumer) when the recents module was carved out; the SSR-safe `useRecents` hook became the canonical read path.
- **Impact**: Misleading public API — invites a new caller to read localStorage synchronously (SSR-unsafe) instead of going through `useRecents`. Minor; no runtime cost.
- **Fix sketch**: Drop the `export` keyword (make it module-local), or keep it exported only if a documented external read is intended. Quick win.

## 3. The `navText` has-fallback closure is re-declared identically in three shell surfaces
- **Severity**: Medium
- **Category**: duplication
- **File**: app/features/Workspace.tsx:83, app/features/WorkspaceNav.tsx:28, app/features/CommandPalette.tsx:147 (and KeyboardShortcuts.tsx:96 as `tabLabel`)
- **Scenario**: Four call sites each wrap the shared `navLabel(t, key, fallback)` helper in a tiny per-component closure: `Workspace`/`WorkspaceNav` define `const navText = (key, fallback) => navLabel(t, key, fallback)`; `CommandPalette` defines `tabLabel = (id, fallback) => navLabel(nav, \`tabs.${id}\`, fallback)`; `KeyboardShortcuts` defines the same `tabLabel`. The `tabs.<id>` key-prefix convention is re-spelled at each site. Confirmed via grep for the closure definitions.
- **Root cause**: `navLabel` was correctly centralized (its own comment notes it replaced inline copies), but the thin `tabLabel(id, fallback)` adapter that prepends `tabs.` was not, so it got re-typed per consumer.
- **Impact**: Low-grade churn: if the catalog key prefix ever changes (`tabs.` → something else) it must be edited at 3+ sites, partly defeating the purpose of having `navLabel`. The `groups.`-prefix variant in the two sidebars has the same issue.
- **Fix sketch**: Add `tabLabel(t, id, fallback)` and `groupLabel(t, key, fallback)` thin exports next to `navLabel` in `tabs.ts`; have all four surfaces import them instead of re-declaring local closures.

## 4. `app/control/page.tsx` is in this context's scope but belongs to the Oversight/dev-case domain
- **Severity**: Low
- **Category**: structure
- **File**: app/control/page.tsx (405 lines — the largest file in scope)
- **Scenario**: The file is the autonomy "control room" (kill switch, human gates, audit trail, outcome calibration) talking to `/api/devcase/*`. It shares nothing with the App-Shell/Navigation concern beyond living under `app/` — no tabs, palette, recents, attention, or i18n-shell code. It was likely swept into this context group by directory proximity rather than responsibility.
- **Root cause**: Context-map assignment, not a code defect.
- **Impact**: Audit noise; a 405-line single-responsibility admin page reviewed under the wrong lens. Not a refactor target on its own merits.
- **Fix sketch**: Re-home `app/control/page.tsx` to the Oversight / Dev-cases context in the context-map; no source change.

## 5. Locale-config comment references a "middleware" that is now `proxy.ts`
- **Severity**: Low
- **Category**: cleanup
- **File**: i18n/request.ts:6 (and i18n/locales.ts header)
- **Scenario**: Comments say the locale is "set by the in-app switcher or the `?lang` proxy" / "Matches the `?lang` middleware". There is no `middleware.ts` in the repo (`find -name middleware.*` hits only `.next/` build artifacts); the actual `?lang` → `NEXT_LOCALE` cookie writer lives in `proxy.ts:87-95` (Next 16's renamed entrypoint). `request.ts` correctly says "proxy"; `locales.ts:2-3` still says "middleware".
- **Root cause**: A comment not updated when Next 16 renamed `middleware.ts` to `proxy.ts`.
- **Impact**: Mildly misleading for someone grepping for `middleware`. Zero runtime effect. (Note: `resolveAcceptLanguage` IS reachable — called by `getServerLocale` at server.ts:13 — so it is NOT dead despite the stale comment.)
- **Fix sketch**: s/middleware/proxy/ in the `locales.ts` `resolveAcceptLanguage` doc-comment.

## 6. `OG_LOCALE` (layout.tsx) duplicates the locale universe instead of deriving from LOCALES
- **Severity**: Low
- **Category**: duplication
- **File**: app/layout.tsx:39
- **Scenario**: `const OG_LOCALE: Record<string, string> = { en: "en_US", cs: "cs_CZ" }` hand-lists the locale keys, with a "Keep in sync with the LOCALES universe" comment. `LOCALES = ["en","cs"]` is the documented single source of truth (locales.ts) that everything else derives from; this map is a manual parallel list a new locale must remember to extend, and the `?? "en_US"` fallback silently hides a forgotten entry.
- **Root cause**: BCP-47→OG-region mapping needs per-locale data not in `LOCALES`, so it was written as a standalone literal rather than a `Record<Locale, string>` the compiler would force-complete.
- **Impact**: Adding a locale that's missed here ships an OG tag mislabeled `en_US` under a non-English document, with no compile error. Small, but it's the exact drift the `LOCALES` pattern exists to prevent.
- **Fix sketch**: Type it as `Record<Locale, string>` (compiler then requires an entry per locale) so a new locale fails the build until its og:locale is supplied, removing the need for the `?? "en_US"` silent fallback.
