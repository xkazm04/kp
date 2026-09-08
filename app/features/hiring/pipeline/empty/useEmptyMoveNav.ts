"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useShellNavigate } from "@/app/features/shell/nav/shallow-nav";
import { buildTabSwitchUrl, type WorkspaceTabId } from "@/app/features/shell/tabs";

/**
 * "Take me to the tab where this move is done."
 *
 * Both empty-state variants need exactly this and nothing more, so it is hoisted
 * rather than retyped: `buildTabSwitchUrl` off the REACT-tracked search string
 * (never window.location — see the note in tabs.ts), pushed through
 * `useShellNavigate` so a tab switch patches the URL in-document instead of
 * re-fetching the whole RSC payload of a route whose server output does not
 * depend on `?tab=`.
 *
 * The old empty state used `router.push` and paid that toll on every link.
 */
export function useEmptyMoveNav(): (tab: WorkspaceTabId) => void {
  const nav = useShellNavigate();
  const search = useSearchParams();
  const query = search.toString();
  return useCallback((tab: WorkspaceTabId) => nav.push(buildTabSwitchUrl(tab, query)), [nav, query]);
}
