"use client";

// The Subway's signage: the station marker on a track, the two waiting indicators
// before a role title, and the header row of station names.

import { META_LABEL } from "@/app/_components/ui/recipes";
import { useTranslations } from "next-intl";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import { AVATAR_RING } from "../mapAvatar";
import type { LineAttention as LineCounts } from "./lineAttention";

/** The map's visible key for the two signals carried by every line. */
export function SubwayKey() {
  const t = useTranslations("pipeline.board");
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-stone-200 px-4 py-2 text-sm text-steel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-ink">{t("scoreRingKey")}</span>
        {(["strong", "mid", "weak", "null"] as const).map((tone) => (
          <span key={tone} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`h-3 w-3 rounded-full bg-white ${AVATAR_RING[tone]}`} />
            {t(`scoreRing.${tone}`)}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-ink">{t("waitingDotKey")}</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-coral" />{t("waitingHumanKey")}</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-steel" />{t("waitingAiKey")}</span>
      </div>
    </div>
  );
}

/** Filled coral when people stand here, a hollow stone ring when the platform is
 *  empty. Grows slightly on cell hover (CSS only, off under reduced motion). */
export function Station({ occupied }: { occupied: boolean }) {
  return (
    <span
      aria-hidden
      style={{ pointerEvents: "none" }}
      className={
        occupied
          ? "block h-3 w-3 shrink-0 rounded-full border-2 border-coral bg-coral transition-transform duration-150 group-hover:scale-125 motion-reduce:transition-none"
          : "block h-2.5 w-2.5 shrink-0 rounded-full border-2 border-stone-300 bg-white transition-transform duration-150 group-hover:scale-125 motion-reduce:transition-none"
      }
    />
  );
}

/** The two indicators before a role title: a coral dot for candidates waiting on a
 *  PERSON (a pending approval, a human-run step) and a steel dot for candidates
 *  waiting on the AI (an AI-run step not yet resolved), each with its count. A kind
 *  nobody is waiting on draws a hollow dot and no number. One accessible name carries
 *  both sentences (lineAttention.ts decides who waits on what). */
export function LineAttention({ counts, label }: { counts: LineCounts; label: string }) {
  return (
    <span role="img" aria-label={label} title={label} className="grid w-7 shrink-0 gap-1">
      <WaitingPip count={counts.human} fill="bg-coral" />
      <WaitingPip count={counts.ai} fill="bg-steel" />
    </span>
  );
}

/** The first column's rejected count — a small red mark after the head-count that
 *  opens the lane's rejected shelf. Absent when the lane has rejected nobody. */
export function RejectedMark({ count, label, onOpen }: { count: number; label: string; onOpen: (rect: DOMRect) => void }) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-haspopup="dialog"
      onClick={(ev) => onOpen(ev.currentTarget.getBoundingClientRect())}
      className="focus-ring nums inline-flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-full bg-red-50 px-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-red-700" />
      {count}
    </button>
  );
}

function WaitingPip({ count, fill }: { count: number; fill: string }) {
  const on = count > 0;
  return (
    <span aria-hidden className="nums flex items-center gap-1 text-[10px] font-semibold leading-none text-steel">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${on ? fill : "border border-stone-300"}`} />
      {on ? count : null}
    </span>
  );
}

/** Metro signage: station names above the tracks, each with a tick dropping onto
 *  the line below it. */
export function StationHeader({
  axis,
  label,
  help,
  gridStyle,
  lineColLabel,
}: {
  axis: readonly StageDef[];
  label: (stage: StageDef) => string;
  help: (stageId: string) => string;
  gridStyle: React.CSSProperties;
  lineColLabel: string;
}) {
  return (
    <div className="grid border-b border-stone-200 bg-paper" style={gridStyle} role="row">
      <div
        role="columnheader"
        className={`${META_LABEL} sticky left-0 z-20 border-r border-stone-200 bg-paper px-3 py-2`}
      >
        {lineColLabel}
      </div>
      {axis.map((stage, i) => (
        <div
          key={stage.id}
          role="columnheader"
          title={help(stage.id)}
          className={`${META_LABEL} relative border-r border-stone-200 px-3 pb-3 pt-2 last:border-0`}
        >
          <span className="text-stone-400">{i + 1}.</span> {label(stage)}
          <span aria-hidden className="absolute bottom-0 left-3 h-2 w-px bg-stone-300" />
        </div>
      ))}
    </div>
  );
}
