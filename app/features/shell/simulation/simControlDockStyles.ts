// Shared button class-builders for the Flight Deck control dock, split out of
// SimControlDock.tsx (ctrlBase/ctrlGhost/ctrlToggle were local consts there) so
// both the main dock and the sim-console face can build the same classes.
export const ctrlBase = "focus-ring inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-all";
export const ctrlGhost = `${ctrlBase} border border-stone-200 text-steel hover:border-coral/40 hover:text-ink`;
export const ctrlToggle = (on: boolean): string =>
  `${ctrlBase} border px-2.5 ${on ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:border-coral/40 hover:text-ink"}`;
