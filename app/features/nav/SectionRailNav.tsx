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
 */

import { useState, type ReactNode } from "react";
import type { AttentionCounts } from "@/app/features/useAttention";
import { navItemClass, type NavGroup, type WorkspaceTabDef, type WorkspaceTabId } from "@/app/features/tabs";
import { HIRING_FALLBACK_LABEL, PINNED_SECTION, SECTION_ICON, sectionOf, TAB_ICON } from "./nav-meta";

export function SectionRailNav({
  groups,
  navActive,
  onSelect,
  attention,
  navText,
  attentionLabel,
  attentionGoLabel,
  sliceHrefFor,
  onSliceNav,
  railTop,
  panelHeader,
  panelFooter,
}: {
  groups: NavGroup[];
  navActive: WorkspaceTabId;
  onSelect: (id: WorkspaceTabId) => void;
  attention: AttentionCounts | null;
  /** translate a nav key (groups.<section> / tabs.<id>) with an English fallback */
  navText: (key: string, fallback: string) => string;
  attentionLabel: (count: number) => string;
  attentionGoLabel: (count: number) => string;
  /** the pre-filtered-slice href for a badged item, or null (no second target) */
  sliceHrefFor: (item: WorkspaceTabDef) => string | null;
  onSliceNav: (href: string) => void;
  railTop?: ReactNode;
  panelHeader?: ReactNode;
  panelFooter?: ReactNode;
}) {
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

  const railGroups = groups.filter((g) => sectionOf(g) !== PINNED_SECTION);
  const pinnedGroup = groups.find((g) => sectionOf(g) === PINNED_SECTION);

  const groupLabel = (group: NavGroup) =>
    navText(`groups.${sectionOf(group)}`, group.label ?? HIRING_FALLBACK_LABEL);

  const railButton = (group: NavGroup, pinned = false) => {
    const section = sectionOf(group);
    const Icon = SECTION_ICON[section];
    const current = section === shown;
    const label = groupLabel(group);
    return (
      <button
        key={section}
        type="button"
        onClick={() => setOpenSection(section)}
        aria-pressed={current}
        title={label}
        className={`focus-ring flex flex-col items-center gap-1 rounded-lg px-1 py-2 transition-colors ${pinned ? "mt-auto" : ""} ${
          current ? "bg-coral/10 text-coral dark:border dark:border-coral/30" : "text-steel hover:bg-stone-100 hover:text-ink"
        }`}
      >
        {Icon ? <Icon size={20} aria-hidden /> : <span className="h-5 w-5 rounded-full bg-current opacity-40" aria-hidden />}
        <span className="text-[10.5px] font-semibold leading-none">{label}</span>
      </button>
    );
  };

  return (
    <div className="flex h-full w-full min-h-0">
      {/* ── Level 1 — icon rail ── */}
      <div className="flex w-16 shrink-0 flex-col gap-1 border-r border-stone-200 bg-paper p-2">
        {railTop}
        <div className="flex flex-1 flex-col gap-1">{railGroups.map((g) => railButton(g))}</div>
        {pinnedGroup ? railButton(pinnedGroup, true) : null}
      </div>

      {/* ── Level 2 — items of the selected group ── */}
      <div className="flex min-w-0 flex-1 flex-col bg-paper">
        {panelHeader}
        <p className="px-3 pb-1.5 pt-3 text-sm font-semibold uppercase tracking-[0.12em] text-steel/70">
          {shownGroup ? groupLabel(shownGroup) : null}
        </p>
        <nav
          key={shown}
          aria-label={shownGroup ? groupLabel(shownGroup) : undefined}
          className="animate-fade-in min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3"
        >
          {shownGroup?.items.map((item) => {
            const isActive = item.id === navActive;
            const Icon = TAB_ICON[item.id];
            // SHELL2: live queue-depth pill for items that declared a badgeKey.
            const badge = item.badgeKey && attention ? attention[item.badgeKey] : 0;
            // Items with badgeParams get a second click target: the badge opens the
            // tab pre-filtered to the counted slice. Rendered as a SIBLING of the row
            // button (a button may not nest interactive content), overlaid on the
            // space the row reserves via padding.
            const sliceHref = badge > 0 ? sliceHrefFor(item) : null;
            return (
              <div key={item.id} className={sliceHref ? "relative" : "contents"}>
                <button
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => onSelect(item.id)}
                  className={`group focus-ring relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-base font-medium transition-colors ${navItemClass(isActive)} ${sliceHref ? "pr-9" : ""}`}
                >
                  {isActive ? (
                    <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-coral" aria-hidden />
                  ) : null}
                  {Icon ? (
                    <Icon size={17} aria-hidden className={`shrink-0 ${isActive ? "text-coral" : "text-steel group-hover:text-ink"}`} />
                  ) : (
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? "bg-coral" : "bg-stone-300"}`} aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate text-left">{navText(`tabs.${item.id}`, item.label)}</span>
                  {badge > 0 && !sliceHref ? (
                    <span
                      aria-label={attentionLabel(badge)}
                      className="shrink-0 rounded-full bg-coral/10 px-1.5 py-0.5 text-sm font-semibold leading-none text-coral"
                    >
                      {badge}
                    </span>
                  ) : null}
                </button>
                {sliceHref ? (
                  <button
                    type="button"
                    title={attentionGoLabel(badge)}
                    aria-label={attentionGoLabel(badge)}
                    onClick={() => onSliceNav(sliceHref)}
                    className="focus-ring absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-coral/10 px-1.5 py-0.5 text-sm font-semibold leading-none text-coral hover:bg-coral/20"
                  >
                    {badge}
                  </button>
                ) : null}
              </div>
            );
          })}
        </nav>
        {panelFooter}
      </div>
    </div>
  );
}
