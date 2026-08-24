// Shared button class-builders for the Flight Deck control dock, split out of
// SimControlDock.tsx (ctrlBase/ctrlGhost/ctrlToggle were local consts there) so
// both the main dock and the sim-console face can build the same classes.
export const ctrlBase = "focus-ring inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-all";
export const ctrlGhost = `${ctrlBase} border border-stone-200 text-steel hover:border-coral/40 hover:text-ink`;
export const ctrlToggle = (on: boolean): string =>
  `${ctrlBase} border px-2.5 ${on ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:border-coral/40 hover:text-ink"}`;

/** LAYER-1 toolbar control — the two-layer dock's first level. Same coral-active
 *  vocabulary as ctrlToggle and DeckTile (the dock speaks coral for "on", not the
 *  segmented control's bg-ink pill), but icon-first and a touch taller so the row
 *  reads as chrome rather than as one more inline button. Tokens only, so both
 *  themes resolve through globals.css. */
export const dockToolbarBtn = (on: boolean): string =>
  `focus-ring inline-flex h-10 items-center gap-2 rounded-lg border px-2.5 text-sm font-semibold transition-colors ${
    on ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-ink hover:border-coral/40"
  }`;
