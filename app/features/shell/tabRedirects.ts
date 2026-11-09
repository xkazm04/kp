// Tabs whose surface MOVED inside another tab, and where each now lives. Unlike
// LEGACY_TAB_ALIASES (tabs.ts) — a retired id mapped onto a live TAB — a redirect lands on a
// place INSIDE a tab, so it carries the destination's own inbox param as well (`?sec=` for the
// Channels tab's Night Post). The id itself stays a live WorkspaceTabId: its nav item and its
// g-chord (workspaceChords.ts) are unchanged muscle memory, and every link that still builds
// `?tab=<id>` (bookmarks, other tabs, the Google OAuth callback) keeps landing — on the new home.
//
// Pure (no React, no URL object of the browser's): Workspace.tsx applies it to an arrival and
// to a tab pick; tabRedirects.test.ts pins it.

import { buildUrl, type WorkspaceTabId } from "./tabs";

export type TabRedirect = {
  tab: WorkspaceTabId;
  /** The destination's inbox param(s), for a bare arrival or a tab pick. */
  params: Readonly<Record<string, string>>;
  /** Overrides when a specific query rides the arrival (first match wins), so a landing that
   *  carries an outcome opens on the part that renders it. */
  when?: readonly { query: string; params: Readonly<Record<string, string>> }[];
};

export const TAB_REDIRECTS: Readonly<Partial<Record<WorkspaceTabId, TabRedirect>>> = {
  // Settings > Integrations was folded into the Night Post's Connectors deck (comms channels C5):
  // the calendar, ATS and agent-bridge panels live there now, beside the connector catalog. The
  // Google OAuth callback still redirects to `/?tab=integrations&calendar=<code>`
  // (app/api/calendar/google/callback/route.ts); the `calendar` param rides through untouched and
  // the deck opens on its calendar part, where the calendar panel reads and renders the outcome.
  integrations: {
    tab: "channels",
    params: { sec: "connectors" },
    when: [{ query: "calendar", params: { sec: "connectors:calendar" } }],
  },
};

/** The live tab an id lands on: its redirect's destination, or the id itself. */
export function redirectedTab(id: WorkspaceTabId): WorkspaceTabId {
  return TAB_REDIRECTS[id]?.tab ?? id;
}

/** The destination params for `id`, given the query it arrived with; null = no redirect. */
export function redirectParams(id: WorkspaceTabId, search: string): Record<string, string> | null {
  const r = TAB_REDIRECTS[id];
  if (!r) return null;
  const query = new URLSearchParams(search);
  const hit = r.when?.find((w) => query.has(w.query));
  return { ...r.params, ...(hit?.params ?? {}) };
}

/** The URL an ARRIVAL at a redirected tab is rewritten to (`?tab=` names the new home, its inbox
 *  param is added, every other param — the OAuth outcome included — is kept); null when the
 *  arrival names no redirected tab. */
export function tabRedirectUrl(search: string): string | null {
  const raw = new URLSearchParams(search).get("tab");
  const r = raw ? TAB_REDIRECTS[raw as WorkspaceTabId] : undefined;
  if (!r) return null;
  return buildUrl({ ...redirectParams(raw as WorkspaceTabId, search), tab: r.tab }, search);
}
