// Shared types + the search-hit → href mapping for the command palette, split out
// of CommandPalette.tsx so the component stays under the 200-line file cap.
import type { KeyboardEvent, RefObject } from "react";
import type { useTranslations } from "next-intl";
import { buildUrl, clearedTabScopedParams, type WorkspaceTabId } from "./tabs";
import type { PaletteListView } from "./workspacePaletteResults";

/** Everything the palette BODY needs from the CommandPalette host — the host
 *  owns state (query, highlight, search); the body only renders. */
export type PaletteViewProps = {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (value: string) => void;
  onInputKey: (e: KeyboardEvent<HTMLInputElement>) => void;
  items: PaletteItem[];
  active: number;
  listView: PaletteListView;
  error: string | null;
  /** "⌘K" / "Ctrl K" — the platform-resolved shortcut label. */
  kbdHint: string;
  t: ReturnType<typeof useTranslations>;
  nav: ReturnType<typeof useTranslations>;
  go: (item: PaletteItem) => void;
  setSelected: (i: number) => void;
  onClose: () => void;
};

export type SearchHit = { type: "profile" | "entry" | "job" | "jd" | "analysis"; id: string; label: string; sub: string | null };
export type PaletteItem = {
  key: string;
  group: string;
  // Second-level heading INSIDE a group — the sidebar section a "Go to" tab
  // belongs to (Hiring / Library / Tools / Insights / Settings), already
  // localized. So the navigator mirrors the nav's own hierarchy instead of
  // flattening ~20 tabs into one undifferentiated list. Absent on every other
  // group (recents, actions, entity hits are flat by nature).
  section?: string;
  label: string;
  sub: string | null;
  // Navigation target — every item has exactly one of href/action.
  href?: string;
  // 5d2e0998 — non-navigation commands (the guided tour). Runs on pick.
  action?: () => void;
  // Entity identity for SHELL3 recents — picking the item records it (re-picks
  // re-front via recordRecent's dedup). Absent on tab actions.
  recent?: { type: SearchHit["type"]; id: string };
  // The destination tab of a "Go to" item — the preview pane's key for tabs
  // (entities key off `recent`).
  tabId?: WorkspaceTabId;
};

export const DEBOUNCE_MS = 200;
// Hit order mirrors how a recruiter recalls things: people first, then roles.
export const HIT_TYPE_ORDER: SearchHit["type"][] = ["profile", "entry", "job", "jd", "analysis"];

export function hitHref(hit: SearchHit, search: string): string {
  switch (hit.type) {
    case "profile":
      return buildUrl({ ...clearedTabScopedParams(), tab: "matrix", profile: hit.id }, search);
    case "entry":
      // No per-entry deep link exists; the board's ?q= filter (ANA1) isolates
      // the candidate by label — same place the drawer opens from.
      return buildUrl({ ...clearedTabScopedParams(), tab: "pipeline", q: hit.label }, search);
    case "job":
      return buildUrl({ ...clearedTabScopedParams(), tab: "jobs", job: hit.id }, search);
    case "jd":
      return `/jds/${encodeURIComponent(hit.id)}`;
    case "analysis":
      return `/history/${encodeURIComponent(hit.id)}`;
  }
}
