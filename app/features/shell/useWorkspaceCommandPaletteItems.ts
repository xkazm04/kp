// The palette's result-list assembly, split out of CommandPalette.tsx so the
// component stays under the 200-line file cap. Builds the same ordered item list
// (recents → "Go to" tabs → tour action → search hits) the component used to build
// inline in its useMemo — verbatim logic, just relocated.
import { useMemo } from "react";
import type { useTranslations } from "next-intl";
import type { RecentItem } from "./recents";
import { buildTabSwitchUrl, HIRING_FALLBACK_LABEL, navLabel, NAV_GROUPS, sectionOf, type WorkspaceTabId } from "./tabs";
import { hitHref, HIT_TYPE_ORDER, type PaletteItem, type SearchHit } from "./workspaceCommandPaletteTypes";

type Translate = ReturnType<typeof useTranslations>;

export function useWorkspaceCommandPaletteItems({
  query,
  hits,
  search,
  recents,
  simRunning,
  simStart,
  nav,
  t,
}: {
  query: string;
  hits: SearchHit[];
  search: string;
  recents: RecentItem[];
  simRunning: boolean;
  simStart: () => void;
  nav: Translate;
  t: Translate;
}): PaletteItem[] {
  // Localized tab label with the same has-fallback contract Workspace uses
  // (shared navLabel helper in tabs.ts).
  const tabLabel = (id: WorkspaceTabId, fallback: string): string => navLabel(nav, `tabs.${id}`, fallback);

  return useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const out: PaletteItem[] = [];
    // SHELL3: the resting state leads with what was just worked on — recents
    // make the palette a "resume" surface before a search one.
    if (!q) {
      for (const r of recents) {
        out.push({
          key: `recent-${r.type}-${r.id}`,
          group: "recent",
          label: r.label,
          sub: null,
          href: r.href,
          recent: { type: r.type, id: r.id },
        });
      }
    }
    // Jump-to-tab actions: all of them on an empty query (the palette's resting
    // state is a navigator), narrowed by label/id match while typing. Walked
    // group-by-group (not flatMap'd) so each item carries its sidebar section —
    // the "Go to" block then renders the SAME first-level hierarchy as the rail,
    // and in the same order, with no second declaration of it here.
    for (const group of NAV_GROUPS) {
      const section = navLabel(nav, `groups.${sectionOf(group)}`, group.label ?? HIRING_FALLBACK_LABEL);
      for (const def of group.items) {
        const label = tabLabel(def.id, def.label);
        if (!q || label.toLowerCase().includes(q) || def.id.includes(q)) {
          out.push({
            key: `tab-${def.id}`,
            group: "tabs",
            section,
            label,
            sub: null,
            href: buildTabSwitchUrl(def.id, search),
          });
        }
      }
    }
    // The tour command: offered at rest and under "tour"/"demo"-flavored
    // queries; hidden while a run is live (SimBar owns pause/stop then).
    const tourLabel = t("tourAction");
    if (!simRunning && (!q || tourLabel.toLowerCase().includes(q) || "tour story demo prohlídka příběh".includes(q))) {
      out.push({
        key: "action-tour",
        group: "actions",
        label: tourLabel,
        sub: t("tourSub"),
        action: simStart,
      });
    }
    for (const type of HIT_TYPE_ORDER) {
      for (const hit of hits.filter((h) => h.type === type)) {
        out.push({
          key: `${hit.type}-${hit.id}`,
          group: hit.type,
          label: hit.label,
          sub: hit.sub,
          href: hitHref(hit, search),
          recent: { type: hit.type, id: hit.id },
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tabLabel is stable per locale; nav/t hooks re-render on locale change anyway
  }, [query, hits, search, recents, simRunning, simStart]);
}
