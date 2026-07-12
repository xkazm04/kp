/** While an open Select is nested in a dialog (useDialogA11y), these keys must be
 *  consumed by the Select — their propagation stopped — so they don't also trigger the
 *  dialog's Escape-to-close / Enter-to-submit. Only Escape and Enter reach a dialog's key
 *  handler; navigation keys (arrows/Home/End) are harmless to let bubble, but the two that
 *  alter dialog state must not. In its own `.ts` module so it's unit-testable — the bare
 *  `node --test` runner strips `.ts` types but cannot load a `.tsx` (JSX). */
export function selectConsumesKeyWhileOpen(key: string): boolean {
  return key === "Escape" || key === "Enter";
}
