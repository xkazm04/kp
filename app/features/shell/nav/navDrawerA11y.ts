// Pure a11y-state decisions for the app-shell nav drawer. Extracted from Workspace
// (a .tsx the node --test runner can't load) so the one rule that's easy to get
// subtly wrong stays unit-testable: the <aside> is BOTH the permanent desktop rail
// (md+) and the off-canvas mobile drawer, so every "hide it from the tab order /
// a11y tree" or "trap focus" decision MUST be gated on isMobile — otherwise the
// always-visible desktop nav would be made inert or the desktop page would be
// trapped. bug-ui-scan 2026-07-09 (app-shell-navigation #1).

/**
 * Whether the drawer's contents (command palette, ~20 nav buttons, language/theme
 * switchers, sign-out) are reachable — in the tab order and the accessibility tree.
 * They're reachable only when the drawer is the visible desktop rail (md+, i.e.
 * !isMobile) OR the opened mobile drawer. A collapsed mobile drawer must not be.
 */
export function isDrawerContentInteractive(isMobile: boolean, open: boolean): boolean {
  return !isMobile || open;
}

/**
 * The inverse, applied as the `inert` attribute on the <aside>: mark it inert exactly
 * when its content must leave the tab order / a11y tree — the collapsed mobile drawer.
 * This is what makes the hamburger's `aria-expanded={open}` truthful (the "collapsed"
 * content is genuinely gone, not merely translated off-canvas).
 */
export function isDrawerInert(isMobile: boolean, open: boolean): boolean {
  return !isDrawerContentInteractive(isMobile, open);
}

/**
 * Whether <main> should be `inert`. While the mobile drawer is open it's modal: the
 * rest of the page is inert so keyboard/AT focus can't leak behind the scrim. Desktop
 * (where the rail is always visible alongside content) is never trapped.
 */
export function isMainInert(isMobile: boolean, open: boolean): boolean {
  return isMobile && open;
}

/**
 * Whether the modal focus-trap controller should be mounted (which reuses the shared
 * useDialogA11y machinery: focus-in, Tab-trap, Escape, focus-restore to the hamburger).
 * Same predicate as isMainInert today, but named for its own call site so the two can
 * diverge without re-reasoning the truth table.
 */
export function shouldTrapDrawerFocus(isMobile: boolean, open: boolean): boolean {
  return isMobile && open;
}
