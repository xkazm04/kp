import { buildUrl, clearedTabScopedParams, type TabScopedParamKey, type WorkspaceTabId } from "../features/shell/tabs.ts";

/** An upstream hop of a chain-aware empty state. `params` carries a scope the
 *  empty state KNOWS (e.g. the job the user is already filtered to) into the
 *  destination; never a guess. */
export type ChainLink = { tab: WorkspaceTabId; label: string; params?: Partial<Record<TabScopedParamKey, string>> };

/**
 * The href for a chain link: select the tab, clear every tab-scoped param so the
 * destination opens clean (what `buildTabSwitchUrl` does), THEN apply the link's
 * own params. The order is the point - clearing after would drop them again.
 */
export function chainLinkHref(link: Pick<ChainLink, "tab" | "params">, search: string): string {
  return buildUrl({ ...clearedTabScopedParams(), tab: link.tab, ...link.params }, search);
}
