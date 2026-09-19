"use client";

// The evidence a card carries under its name: the weighted score dimensions and the
// skill chips. Two bar shapes on purpose —
//   • DimensionBars: HORIZONTAL rows (label · value · bar). The roomy cards and the
//     candidate detail use it, so the name and score keep the head of the card and
//     every dimension is named in full rather than by its first letter.
//   • MiniBarChart: the minified vertical chart, where at 144px the SHAPE (flat /
//     spiky) is the only readable signal.

import { Skeleton } from "@/app/_components/Skeleton";
import { clampPercent, scoreTone } from "@/app/_lib/format";
import type { ScoreDimension } from "@/app/features/shared/matchTypes";
import { TONE_BAR } from "../mapTone";

const SKELETON_ROWS = [0.7, 0.45, 0.6] as const;

export function DimensionBars({ dims, loading }: { dims: readonly ScoreDimension[]; loading: boolean }) {
  if (loading) {
    return (
      <span className="flex w-full flex-col gap-2" aria-hidden="true">
        {SKELETON_ROWS.map((f, i) => (
          <span key={i} className="block h-2" style={{ width: `${f * 100}%` }}>
            <Skeleton className="h-full w-full rounded-full" />
          </span>
        ))}
      </span>
    );
  }
  if (dims.length === 0) return null;
  return (
    <span className="flex w-full flex-col gap-1.5" aria-hidden="true">
      {dims.map((d) => {
        const pct = clampPercent(d.percent);
        return (
          <span key={d.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-xs text-steel">{d.label || d.key}</span>
            <span className="nums text-xs font-semibold text-ink">{Math.round(pct)}</span>
            <span className="col-span-2 block h-1.5 overflow-hidden rounded-full bg-stone-100">
              <span
                className={`block h-full rounded-full ${TONE_BAR[scoreTone(pct)]}`}
                style={{ width: `${Math.max(4, pct)}%` }}
              />
            </span>
          </span>
        );
      })}
    </span>
  );
}

const MINI_HEIGHT = 26;
const MINI_BAR = 5;
const MINI_SKELETON = [0.5, 0.8, 0.35, 0.65, 0.45] as const;

export function MiniBarChart({ dims, loading }: { dims: readonly ScoreDimension[]; loading: boolean }) {
  if (loading) {
    return (
      <span className="flex items-end gap-1" style={{ height: MINI_HEIGHT }} aria-hidden="true">
        {MINI_SKELETON.map((f, i) => (
          <span key={i} className="block" style={{ height: MINI_HEIGHT * f, width: MINI_BAR }}>
            <Skeleton className="h-full w-full rounded-sm" />
          </span>
        ))}
      </span>
    );
  }
  if (dims.length === 0) return null;
  return (
    <span className="flex items-end gap-1" aria-hidden="true">
      {dims.map((d) => {
        const pct = clampPercent(d.percent);
        return (
          <span key={d.key} className="flex flex-col items-center gap-0.5">
            <span className="flex items-end rounded-sm bg-stone-100" style={{ height: MINI_HEIGHT, width: MINI_BAR }}>
              <span
                className={`w-full rounded-sm ${TONE_BAR[scoreTone(pct)]}`}
                style={{ height: `${Math.max(4, pct)}%` }}
              />
            </span>
            <span className="text-xs uppercase text-steel">{(d.label || d.key).charAt(0)}</span>
          </span>
        );
      })}
    </span>
  );
}

export function SkillChips({
  matched,
  missingLabel,
  limit,
}: {
  matched: readonly string[];
  /** "3 missing", or null when nothing is missing. */
  missingLabel: string | null;
  limit: number;
}) {
  if (matched.length === 0 && !missingLabel) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {matched.slice(0, limit).map((s) => (
        <span key={s} className="rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-700">
          {s}
        </span>
      ))}
      {missingLabel ? (
        <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">{missingLabel}</span>
      ) : null}
    </span>
  );
}
