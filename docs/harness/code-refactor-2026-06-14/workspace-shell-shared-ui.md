> Total: 4 findings (Crit/High/Med/Low: 0/0/3/1)

Scope: context `workspace-shell-shared-ui` (~70 files). Read the two sidebars (Workspace.tsx, WorkspaceNav.tsx), tabs.ts, the command palette + keyboard shortcuts, every shared primitive (Badge, Modal, Markdown, Skeleton, SegmentedControl, ChainEmptyState, CompletionCta, ErrorBoundary, ThemeToggle, LanguageSwitcher, the ui/* recipes), the recents/attention wiring, the landing/spark pages, the OG/icon routes, and the shell lib helpers.

Headline: this shell is unusually clean — **no genuinely-dead shared components, hooks, or lib exports were found**. Every primitive, hook (useJsonFetch / useLoader / useReducedMotion / useTheme / useAttention / useRecents …), and helper (brand, safe-url, public-base-url, export-utils, og-fonts, random-id, use-enum-label, use-error-message, initials, load-state …) has live importers, and the per-symbol greps below confirm zero orphans. The deliberate "two sidebars" duplication the brief warned about IS deliberate (server `Link` vs client tab-switch) and is left alone. The real opportunities are mechanical dedup of a copy-pasted helper and a couple of class-string constants.

## 1. The `nav` has-fallback translate helper is copy-pasted in 4 shell files
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/features/Workspace.tsx:76-79` (`navText`), `app/features/WorkspaceNav.tsx:26-29` (`navText`), `app/features/CommandPalette.tsx:145-148` (`tabLabel`), `app/features/KeyboardShortcuts.tsx:95-98` (`tabLabel`)
- **Evidence**: All four define the identical inline helper — translate a `nav` catalog key (`tabs.<id>` / `groups.<key>`) through `useTranslations("nav")` (or `getTranslations`), falling back to the English string baked into `tabs.ts` when `t.has(key)` is false. Workspace.tsx's own comment ("Mirror of Workspace.tsx navText" in WorkspaceNav.tsx:24-25, "same has-fallback contract Workspace uses" in CommandPalette.tsx:144) documents the copy. Grep `\.has\(k\)|nav\.has\(key\)|t\.has\(k\)` across `app/` shows these four shell sites use the exact same `nav`-namespace shape (other `t.has(...)` sites are different namespaces — enums/channels/billing — and already funnel through `use-enum-label.ts`, the established precedent for "centralize the has-fallback pattern"). The four shell copies are the only un-centralized instances.
- **Impact**: Four bodies to keep in lockstep; a contract tweak (e.g. handling a missing label, or a key-prefix change) has to be made in four places or the two sidebars / palette / overlay silently drift in how they resolve a tab label. Low bug risk today, ongoing maintenance tax.
- **Fix sketch**: Add one helper next to the nav catalog — e.g. in `tabs.ts` export `navKeyOr(t, key, fallback)` (taking the `next-intl` `t`/`getTranslations` return), or a tiny `useNavLabel()` client hook mirroring `useEnumLabel`. Replace the inline `navText`/`tabLabel` in all four files. Server `WorkspaceNav` uses the awaited `getTranslations` form, so the helper should accept the translator instance rather than calling the hook itself. No behavior change; pure consolidation.

## 2. The `<kbd>` chip class string is repeated 5× across the palette + shortcuts overlay
- **Severity**: Low
- **Category**: duplication
- **File**: `app/features/KeyboardShortcuts.tsx:104,110,111,117` and `app/features/CommandPalette.tsx:245`
- **Evidence**: Grep `rounded border border-stone-200 bg-paper px-1.5 py-0.5` returns exactly these 5 lines — the literal keycap styling, identical except the palette one swaps `text-sm` for `text-[11px]`. There is already a `recipes.ts` seam (`app/_components/ui/recipes.ts`) whose stated purpose is "the canonical class strings for recurring visual patterns" with behavior-free string constants.
- **Impact**: Cosmetic; restyling the keycap (the only two surfaces that render one) means editing 5 literals. Tiny.
- **Fix sketch**: Add `export const KBD = "rounded border border-stone-200 bg-paper px-1.5 py-0.5 font-semibold text-steel";` to `recipes.ts` and compose at the call sites (`${KBD} text-sm` / `${KBD} text-[11px]`). Sizing stays at the call site per the recipes convention.

## 3. ThemeToggle and LanguageSwitcher hand-roll the same segmented-toggle markup
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/_components/ThemeToggle.tsx:26-45` and `app/_components/LanguageSwitcher.tsx:28-52` (related primitive: `app/_components/SegmentedControl.tsx`)
- **Evidence**: Both render the identical wrapper shell — `role="group"` + `inline-flex items-center gap-0.5 rounded-md border border-stone-200 p-0.5`, mapping options to buttons with `aria-pressed`, and the identical active/inactive treatment `isActive ? "bg-ink text-white" : "text-steel hover:bg-stone-100"`. That `bg-ink`-pill active state is the same visual language the shared `SegmentedControl` formalizes (its comment at lines 16-19 calls `bg-ink` "the app's segmented-control motion standard"). These two footer toggles each re-derive the look and the roving selection by hand.
- **Impact**: The two sidebar-footer toggles can drift from each other and from `SegmentedControl` (border radius, hover, active fill) on any restyle; the wrapper+active-pill duplication is the kind of "shared-primitive drift" this context is prone to.
- **Fix sketch**: SAFE option — extract just the shared wrapper/active-button class strings into a `recipes.ts` constant (e.g. `TOGGLE_GROUP` + `toggleBtn(isActive)`) and have both components compose them; behavior untouched. Do NOT force these onto `SegmentedControl` wholesale: ThemeToggle/LanguageSwitcher use `aria-pressed` button-group semantics (and LanguageSwitcher fires a server action with a `pending` disabled state), which differ from SegmentedControl's `radiogroup`/roving-tabindex contract — a full migration would be a semantics change, not a mechanical dedup. Keep the consolidation at the class-string level.

## 4. `ChainEmptyState` and `CompletionCta` duplicate the deep-link-button rendering
- **Severity**: Low
- **Category**: duplication
- **File**: `app/_components/ChainEmptyState.tsx:40-49` and `app/_components/CompletionCta.tsx:48-59`
- **Evidence**: Both map a `links` array to buttons that `router.push(buildTabSwitchUrl/buildUrl(... clearedTabScopedParams() ..., search.toString()))` and render the same `focus-ring inline-flex items-center gap-1 text-sm font-semibold text-coral hover:underline` label with a trailing `<ArrowRight size={13} aria-hidden />`. The link-rendering loop is effectively identical; only the surrounding container (sunken empty-state panel vs. moss success band) and the `CompletionLink.params` deep-link payload differ.
- **Impact**: The "tab deep-link button" look-and-nav is defined twice; a change to how cross-tab links navigate (or their styling) touches both. Genuinely low — these are two small, intentionally-distinct primitives, so this is a watch-item, not an urgent merge.
- **Fix sketch**: Optionally extract a tiny `<TabLinkButton tab params label />` (one component owning the `buildUrl` + coral-arrow markup) consumed by both. Leave the two outer components as-is. Lowest-priority; only worth doing if a third consumer appears or the link nav contract changes.
