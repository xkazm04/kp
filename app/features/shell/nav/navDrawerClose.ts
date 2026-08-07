// Pure decisions behind "any in-shell navigation closes the mobile drawer". Extracted
// from Workspace (a .tsx the node --test runner can't load) so the central rule is
// unit-testable. bug-ui-scan 2026-07-09 (app-shell-navigation #2): drawer-close was
// wired ONLY into the sidebar tab handler, so the badge-slice pill and the command
// palette — separate navigation entry points — left the drawer parked over the
// freshly-loaded content. Modelling close as "the navigation key changed" makes every
// present and future navigation path (slice, palette, keyboard chord) clear it.

/**
 * The navigation identity that, when it changes, means an in-shell navigation happened.
 * Combining pathname + search covers both the tab-switch / badge-slice case (only the
 * query string moves) and any cross-route case (the pathname moves). No dangling "?"
 * when there is no search, so two truly-identical locations compare equal.
 */
export function navKey(pathname: string, search: string): string {
  return search ? `${pathname}?${search}` : pathname;
}

/**
 * Whether the mobile drawer should close: exactly when the navigation key changed.
 * (The pre-fix behaviour was effectively "never, unless it was a sidebar tab pick".)
 */
export function shouldCloseDrawerOnNav(prevKey: string, nextKey: string): boolean {
  return prevKey !== nextKey;
}
