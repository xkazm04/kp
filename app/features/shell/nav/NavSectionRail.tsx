"use client";

/*
 * Two-level studio sidebar navigation. Principle reused from systedo-case's
 * SectionRailNav ("Variant B"): a narrow icon RAIL holds the first-level groups,
 * and a second PANEL shows only the selected group's tabs — so ~20 modules never
 * stack into one tall column.
 *
 * The panel follows the current route by default (it opens the group that owns the
 * active tab); clicking a rail group PREVIEWS that group's tabs without navigating,
 * and a real tab switch snaps the panel back to the active group. Re-skinned into
 * KandiDate's token system (Studio Light + Spark Dark) — no hardcoded colors, coral
 * as the active accent, the ink/steel/paper neutrals, the sticker idiom in dark.
 *
 * ONE renderer, two modes. `mode="select"` (the interactive SPA shell) drives tabs
 * through the onSelect/onSliceNav callbacks; `mode="link"` (server-rendered deep-link
 * pages — /jds/[slug], /history/[slug]) renders the SAME structure but with items as
 * real anchors to /?tab=<id>, so following a deep link no longer swaps the nav
 * STRUCTURE mid-flow. i18n and the badge-slice hrefs resolve INTERNALLY (via
 * useTranslations + the tabs.ts href helpers) so the link-mode wrapper can be a plain
 * server component — a Server Component can't hand a client component callbacks, only
 * serializable props + the chrome slots below.
 */

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Capability } from "@/app/_lib/auth/roles";
import type { AttentionCounts } from "@/app/features/shell/useAttention";
import { capabilityLabelKey, lockedTabsFor, TAB_CAPABILITY } from "@/app/features/shell/navCapabilities";
import {
  buildUrl,
  clearedTabScopedParams,
  HIRING_FALLBACK_LABEL,
  navLabel,
  sectionOf,
  type NavGroup,
  type WorkspaceTabDef,
  type WorkspaceTabId,
} from "@/app/features/shell/tabs";
import { railTile } from "@/app/_components/ui/recipes";
import { SECTION_ICON } from "./navMeta";
import { NavPanelItem } from "./NavPanelItem";

export function NavSectionRail({
  groups,
  navActive,
  attention,
  showAttention = true,
  capabilities = null,
  search,
  mode = "select",
  onSelect,
  onSliceNav,
  onPrefetchTab,
  railTop,
  railFooter,
  panelHeader,
  panelFooter,
}: {
  groups: NavGroup[];
  navActive: WorkspaceTabId;
  attention: AttentionCounts | null;
  /** May THIS VIEWER see the queue depths? Defaults to true — omitting it keeps
   *  today's behaviour, so the interactive shell needs no change. `false` suppresses
   *  every badge even if `attention` is populated: this renderer also serves
   *  /jds/[slug], which is on the public proxy allow-list, and a cookieless caller
   *  resolves to DEFAULT_WORKSPACE. A host that already withholds the counts (passing
   *  `attention={null}`, as WorkspaceNav does for a non-operator) is equivalent; both
   *  gates compose, and neither depends on the other having landed. */
  showAttention?: boolean;
  /** What this viewer may do here (app/features/shell/navCapabilities.ts). `null` =
   *  not resolved yet, which locks NOTHING — the rail must never hide an owner's
   *  Billing tab because one capability read blipped. The SPA passes the live hook
   *  value; the deep-link sidebar resolves it server-side. */
  capabilities?: readonly Capability[] | null;
  /** the React-tracked query string (buildUrl composes the badge-slice href off it);
   *  the deep-link pages pass "" — a detail page carries no live tab query. */
  search: string;
  /** "select" drives tabs through the callbacks (interactive SPA); "link" renders
   *  the items as real anchors to /?tab=<id> for server-rendered deep-link pages. */
  mode?: "select" | "link";
  /** select mode only — switch to a tab (ignored in link mode). */
  onSelect?: (id: WorkspaceTabId) => void;
  /** select mode only — open the badge's pre-filtered slice (ignored in link mode). */
  onSliceNav?: (href: string) => void;
  /** select mode only — warm a tab's chunk on hover/focus (shell/tabChunks.ts).
   *  Link mode has no use for it: a real anchor gets Next's own <Link> prefetch. */
  onPrefetchTab?: (id: WorkspaceTabId) => void;
  railTop?: ReactNode;
  /** Bottom of the RAIL (first level), below the last section — the appearance /
   *  language preferences (RailPreferences). Settings used to be pinned here. */
  railFooter?: ReactNode;
  panelHeader?: ReactNode;
  panelFooter?: ReactNode;
}) {
  const isLink = mode === "link";
  // i18n resolves here (not via a passed navText) so the link-mode wrapper stays a
  // plain Server Component — it can hand this client renderer serializable props and
  // the chrome slots, but never a function. Same nav catalog + has-fallback contract
  // as the SPA (navLabel in tabs.ts), so labels/badges can't drift between the two.
  const t = useTranslations("nav");
  const navText = (key: string, fallback: string): string => navLabel(t, key, fallback);
  const attentionLabel = (count: number): string => t("attentionBadge", { count });
  const attentionGoLabel = (count: number): string => t("attentionBadgeGo", { count });
  // The pre-filtered-slice href for a badged item (composed off `search`), or null when
  // the item declared no distinct slice — a second click target landing on the exact
  // counted cohort instead of the bare tab.
  const sliceHrefFor = (item: WorkspaceTabDef): string | null =>
    item.badgeParams ? buildUrl({ tab: item.id, ...clearedTabScopedParams(), ...item.badgeParams }, search) : null;

  // The group that owns the active tab — the panel's default.
  const activeGroup = groups.find((g) => g.items.some((it) => it.id === navActive)) ?? groups[0];
  const activeSection = activeGroup ? sectionOf(activeGroup) : "";

  // A previewed group (rail click) overrides the default until the tab changes.
  // Reset the preview during render when the active tab moves (the sanctioned
  // "adjust state from a prior render" pattern) so the panel follows navigation.
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [seenActive, setSeenActive] = useState(navActive);
  if (seenActive !== navActive) {
    setSeenActive(navActive);
    setOpenSection(null);
  }
  const shown = openSection ?? activeSection;
  const shownGroup = groups.find((g) => sectionOf(g) === shown) ?? groups[0];

  // Which second-level rows this viewer cannot open, and why. The rows STAY —
  // disabled, with the capability named — because a door that disappears for the
  // person who holds the key reads as a broken build (navCapabilities.ts).
  const lockedTabs = lockedTabsFor(capabilities);
  const lockedLabel = (cap: Capability) =>
    t("lockedTab", { capability: navText(capabilityLabelKey(cap), cap) });

  const groupLabel = (group: NavGroup) =>
    navText(`groups.${sectionOf(group)}`, group.label ?? HIRING_FALLBACK_LABEL);

  // Warm every chunk in a group the moment the RAIL button is pointed at. The
  // per-item hover (NavPanelItem's onPrefetch) only fires once the panel is
  // already open, so reaching a second-level tab was two sequential waits: open
  // the section, then start the chunk on the item hover a beat before the click.
  // Groups are 2–7 small tab chunks, and prefetchTabChunk is idempotent per
  // document, so this is at most one extra download per group per session.
  const prefetchSection = (group: NavGroup) => {
    if (!onPrefetchTab) return;
    for (const item of group.items) onPrefetchTab(item.id);
  };

  const railButton = (group: NavGroup) => {
    const section = sectionOf(group);
    const Icon = SECTION_ICON[section];
    const current = section === shown;
    const label = groupLabel(group);
    return (
      <button
        key={section}
        type="button"
        onClick={() => {
          setOpenSection(section);
          prefetchSection(group);
        }}
        onMouseEnter={() => prefetchSection(group)}
        onFocus={() => prefetchSection(group)}
        aria-pressed={current}
        title={label}
        className={railTile(current)}
      >
        {Icon ? <Icon size={20} aria-hidden /> : <span className="h-5 w-5 rounded-full bg-current opacity-40" aria-hidden />}
        {/* First-level labels sit one step above the old 11px: the rail is the
            primary wayfinding surface, and 11px read as a caption next to the
            14px+ panel rows. Still an arbitrary value (below the text-sm floor in
            globals.css) because the 4.75rem rail can't hold "Insights" at 14px. */}
        <span className="text-[13px] font-semibold leading-tight">{label}</span>
      </button>
    );
  };

  return (
    <div className="flex h-full w-full min-h-0">
      {/* ── Level 1 — icon rail ── */}
      <div className="flex w-[4.75rem] shrink-0 flex-col gap-1 border-r border-stone-200 bg-paper p-2">
        {railTop}
        <div className="flex flex-1 flex-col gap-1">{groups.map((g) => railButton(g))}</div>
        {/* The rail's bottom slot: workspace-wide preferences (theme, language),
            each collapsed to its ACTIVE icon with the variants in a popup — no
            section is pinned down here anymore (Settings rides the normal flow). */}
        {railFooter ? <div className="mt-auto flex flex-col items-center gap-1 border-t border-stone-200 pt-1.5">{railFooter}</div> : null}
      </div>

      {/* ── Level 2 — items of the selected group ── */}
      <div className="flex min-w-0 flex-1 flex-col bg-paper">
        {panelHeader}
        {/* A real heading (not a styled <p>) so the panel's group name lands in the
            AT heading map; the <nav> below is labelled by the same text. */}
        <h2 className="px-3 pb-1.5 pt-3 text-sm font-semibold uppercase tracking-[0.12em] text-steel/70">
          {shownGroup ? groupLabel(shownGroup) : null}
        </h2>
        <nav
          key={shown}
          aria-label={shownGroup ? groupLabel(shownGroup) : undefined}
          className="animate-fade-in min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3"
        >
          {shownGroup?.items.map((item) => {
            const isActive = item.id === navActive;
            // SHELL2: live queue-depth pill for items that declared a badgeKey.
            // `showAttention` is the viewer gate (see the prop) — a false value means
            // no count reaches the row, whatever `attention` happens to hold.
            const badge = showAttention && item.badgeKey && attention ? attention[item.badgeKey] : 0;
            // Items with badgeParams get a second click target: the badge opens the
            // tab pre-filtered to the counted slice. Rendered as a SIBLING of the row
            // (a button/anchor may not nest interactive content), overlaid on the
            // space the row reserves via padding.
            const sliceHref = badge > 0 ? sliceHrefFor(item) : null;
            return (
              <NavPanelItem
                key={item.id}
                item={item}
                isActive={isActive}
                isLink={isLink}
                badge={badge}
                showAttention={showAttention}
                sliceHref={sliceHref}
                navText={navText}
                attentionLabel={attentionLabel}
                attentionGoLabel={attentionGoLabel}
                onSelect={onSelect}
                onSliceNav={onSliceNav}
                onPrefetch={onPrefetchTab}
                locked={lockedTabs.has(item.id) ? TAB_CAPABILITY[item.id] ?? null : null}
                lockedLabel={lockedLabel}
              />
            );
          })}
        </nav>
        {panelFooter}
      </div>
    </div>
  );
}
