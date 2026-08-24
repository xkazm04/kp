"use client";

// The dock's REST state — the collapsed Candi orb, split out of SimControlDock.tsx
// verbatim when the expanded face became a two-layer toolbar. Unchanged by that
// redesign on purpose: this is the one thing the operator sees 95% of the time,
// so the halo, the awaiting-decisions beacon and the aiBusy pulse stay exactly as
// they were.
import { useTranslations } from "next-intl";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { SIM_PHASES } from "./constants";

export function SimControlDockOrb({
  mode,
  activeIdx,
  simDone,
  awaiting,
  aiBusy,
  onOpen,
}: {
  mode: "sim" | "ops";
  activeIdx: number;
  simDone: boolean;
  awaiting: number;
  aiBusy: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("pipeline.controlCenter");
  // The phase chronology is the guided demo's own vocabulary, so it lives in the
  // `simulation` namespace beside the tour narration rather than in the dock's.
  const tSim = useTranslations("simulation");
  const orbCaption =
    mode === "sim"
      ? activeIdx >= 0
        ? tSim(`phase.${SIM_PHASES[activeIdx].id}`)
        : simDone
          ? t("hired")
          : t("starting")
      : null;

  return (
    // bottom-[max(...)] — clear of the iOS home-indicator strip, where taps feed
    // the system swipe gesture instead of the button (safe-area vars are live
    // because layout.tsx sets viewport-fit=cover).
    <div className="group fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 z-[var(--z-sim-bar)] -translate-x-1/2">
      {/* Sim: a caption bubble above narrates the live phase. */}
      {orbCaption ? (
        <span className="absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-stone-200 bg-white px-3 py-1 text-sm font-medium text-ink shadow-panel">
          {orbCaption}
        </span>
      ) : null}
      {/* Ops: a label slides in on hover so the orb isn't a mystery button. */}
      {mode === "ops" ? (
        <span className="pointer-events-none absolute right-full top-1/2 mr-3 -translate-y-1/2 whitespace-nowrap rounded-full border border-stone-200 bg-white px-3 py-1 text-sm font-medium text-ink opacity-0 shadow-panel transition-opacity group-hover:opacity-100">
          {awaiting > 0 ? t("titleAwaiting", { count: awaiting }) : t("title")}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onOpen}
        aria-label={awaiting > 0 ? t("openAwaiting", { count: awaiting }) : t("open")}
        aria-expanded={false}
        title={t("title")}
        className="focus-ring relative grid h-14 w-14 place-items-center rounded-full border-2 border-stone-300 bg-white shadow-pop ring-4 ring-coral/15 transition-all hover:ring-coral/30"
      >
        <KandidateMark className="h-9 w-9 text-ink [--k-fg:var(--color-paper)] [--k-accent:var(--color-coral)]" />
        {/* Beacon: how many candidates need a human decision right now. */}
        {awaiting > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-coral px-1 text-meta font-bold text-white ring-2 ring-paper nums">
            {awaiting > 99 ? t("countOverflow") : awaiting}
          </span>
        ) : null}
        {/* AI at work — a distinct moss dot in the opposite corner from the beacon. */}
        {aiBusy ? <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-moss ring-2 ring-white motion-safe:animate-pulse" /> : null}
      </button>
    </div>
  );
}
