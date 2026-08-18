// Shared presentation metadata for the command palette: the per-group glyph +
// tone, and the "where does this open" resolver. Kept JSX-free and beside the item
// types so the row, the preview pane and the eyebrows read ONE table instead of
// each re-declaring how a candidate vs. a role vs. a JD is drawn.
import {
  ArrowRight,
  Briefcase,
  Clock3,
  FileSearch,
  FileText,
  LayoutDashboard,
  Play,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { PaletteItem, SearchHit } from "./workspaceCommandPaletteTypes";

/** Every `group` a PaletteItem can carry — the entity hit types + the three
 *  navigator groups (recent / tabs / actions). */
export type PaletteGroup = SearchHit["type"] | "recent" | "tabs" | "actions";

/** Glyph + tint per group. Tints are brand/status tokens only (dual-theme safe). */
export const GROUP_META: Record<PaletteGroup, { icon: LucideIcon; tint: string }> = {
  recent: { icon: Clock3, tint: "bg-stone-100 text-steel" },
  tabs: { icon: ArrowRight, tint: "bg-stone-100 text-steel" },
  actions: { icon: Play, tint: "bg-moss/15 text-moss" },
  profile: { icon: UserRound, tint: "bg-coral/10 text-coral" },
  entry: { icon: LayoutDashboard, tint: "bg-blue-50 text-blue-700" },
  job: { icon: Briefcase, tint: "bg-amber-100 text-amber-700" },
  jd: { icon: FileText, tint: "bg-limewash text-ink" },
  analysis: { icon: FileSearch, tint: "bg-moss/15 text-moss" },
};

export function groupMeta(group: string) {
  return GROUP_META[group as PaletteGroup] ?? GROUP_META.tabs;
}

/** Which workspace tab an entity hit deep-links into (hitHref's targets), or the
 *  non-tab page kind for JD / analysis detail routes. Null for tab actions (they
 *  ARE the destination) and commands. */
export function destinationOf(item: PaletteItem): { tab: "matrix" | "pipeline" | "jobs" } | { page: "jd" | "analysis" } | null {
  switch (item.group) {
    case "profile":
      return { tab: "matrix" };
    case "entry":
      return { tab: "pipeline" };
    case "job":
      return { tab: "jobs" };
    case "jd":
      return { page: "jd" };
    case "analysis":
      return { page: "analysis" };
    default:
      return null;
  }
}
