"use client";

// The two elements that sit OUTSIDE the control panel's own box, in the same
// fixed footer row: the open/close handle centred ABOVE it (round 5 — see
// DockBrand) and the guided-demo entry beyond its right border. The footer had
// spare space around the panel; round 3 spent it on the two things that were
// competing for width inside the row, and round 5 moved the first of them to the
// one place that reads as "this is the thing you just pressed".
//
// NARROW VIEWPORTS — the rule, stated once here because both elements follow it:
// neither element ever hides, because both are the only way to reach something
// (the brand mark IS the lower-the-deck switch; the guide IS the only route into
// the demo). They shed their TEXT instead, so what remains is a 44px square that
// still hits the touch target: the brand text at `lg`, the guide's label at `md`.
// The panel between them carries `min-w-0 flex-1`, so it absorbs the remaining
// width and wraps its own toolbar rather than colliding with either side. Both
// roots are `pointer-events-auto`: the footer frame around them is
// pointer-events-none so its now-transparent gutters do not swallow clicks meant
// for the page behind — see SimControlDock.tsx.
import { useTranslations } from "next-intl";
import { Play } from "lucide-react";
import { CandiSwitch } from "./SimControlDockTiles";
import { DOCK_PANEL_DOM_ID, dockTabDomId } from "./simControlDockLayers";

/** TOP-CENTRE — the deck's handle. Round 4 had reduced this to the bare power
 *  switch ("the logo + brand text does not bring value" — operator, 2026-08-24)
 *  but left it at the row's LEFT edge, and that was the confusion round 5 fixes:
 *  the collapsed dock is the Candi orb at bottom CENTRE, so pressing it appeared
 *  to teleport the one open/close control to the far left, where nothing marked
 *  it as the way back down. It is now pinned above the middle of the footer row —
 *  the same mark, in the same column, in both states, with a chevron badge
 *  (CandiSwitch) naming the direction. Icon-only at every width.
 *
 *  Absolutely positioned against the footer ROW (SimControlDock gives it
 *  `relative`), not against the panel: the row's right side carries the guided-demo
 *  button, so centring on the panel would put the handle off-centre from the orb it
 *  replaces. `bottom-full` keeps it clear of the panel's own top edge, so it can
 *  never sit on top of whatever layer-2 opened. */
export function DockBrand({ aiBusy, onCollapse }: { aiBusy: boolean; onCollapse: () => void }) {
  return (
    <div className="pointer-events-auto absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2">
      <CandiSwitch open onClick={onCollapse} busy={aiBusy} />
    </div>
  );
}

/** OUTSIDE-RIGHT — the deck's ONE invitation, and now its only guided-demo door.
 *  Keeps the sticker treatment the ops panel's tile had (drawn ink outline, paper
 *  fill, coral play medallion, press-down hover) because this is still the one
 *  control that says "watch the whole hiring story" rather than "operate the
 *  board". `open` is the truthful state in all three of guideAction's branches:
 *  it reports whether the console is showing, which is what pressing it changes
 *  either directly (toggle) or by starting a run the mode effect reveals. */
export function DockGuide({ open, onClick }: { open: boolean; onClick: () => void }) {
  const t = useTranslations("pipeline.controlCenter");
  const label = t("guidedDemo");
  return (
    <div className="pointer-events-auto shrink-0 pb-3">
      <button
        type="button"
        id={dockTabDomId("sim")}
        onClick={onClick}
        title={label}
        aria-expanded={open}
        aria-controls={open ? DOCK_PANEL_DOM_ID : undefined}
        className="focus-ring group inline-flex h-11 items-center gap-2.5 rounded-xl border-2 border-ink bg-paper px-3.5 text-sm font-semibold text-ink shadow-sticker-sm transition-all hover:-translate-y-0.5 hover:shadow-pop max-md:px-2.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 dark:-rotate-1 dark:hover:rotate-0"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-coral text-white shadow-sticker-xs transition-transform group-hover:scale-105 motion-reduce:transition-none">
          <Play size={13} aria-hidden className="translate-x-px" />
        </span>
        {/* Label-less below `md`; the accessible name survives in `title` + the
            visually-hidden span, which is out of flow so it costs no gap. */}
        <span className="hidden md:inline">{label}</span>
        <span className="sr-only md:hidden">{label}</span>
      </button>
    </div>
  );
}
