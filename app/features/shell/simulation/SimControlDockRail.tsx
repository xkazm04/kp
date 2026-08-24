"use client";

// The two side elements that sit OUTSIDE the control panel's left and right
// borders, in the same fixed footer row. The footer had spare horizontal space
// beside the panel; round 3 spends it on the two things that were competing for
// width inside the row — the product identity and the one guided-demo entry.
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

/** OUTSIDE-LEFT — the identity block, lifted out of layer 1. The logo is not
 *  decoration: it is the same CandiSwitch that lowers the deck, so the brand and
 *  the power switch are one control, and it keeps the aiBusy pulse it carried in
 *  the row. The mode subtitle comes WITH the brand (it says what the deck is,
 *  which is identity); the "N need you" chip deliberately did NOT — that is live
 *  operational state and stays inside the panel with the controls. */
export function DockBrand({ mode, aiBusy, onCollapse }: { mode: "sim" | "ops"; aiBusy: boolean; onCollapse: () => void }) {
  const t = useTranslations("pipeline.controlCenter");
  return (
    <div className="pointer-events-auto flex shrink-0 items-center gap-2.5 pb-3">
      <CandiSwitch open onClick={onCollapse} busy={aiBusy} />
      <div className="hidden flex-col leading-tight lg:flex">
        <span className="text-meta font-semibold uppercase tracking-wide text-coral">{t("title")}</span>
        <span className="text-sm font-medium text-steel">{mode === "sim" ? t("guidedDemo") : t("modeOps")}</span>
      </div>
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
