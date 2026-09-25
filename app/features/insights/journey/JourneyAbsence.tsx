"use client";

// The five ways this board says "not here" — and the reason there are five.
//
// A hiring record is mostly absence, and the absences are not the same fact.
// Collapsing them is the single defect this whole surface exists to remove, so
// each one gets its own persistent, non-hover, catalog-backed mark:
//
//  BAND-level (the phase as a whole)
//   1 NothingHappened  the phase did not happen AND the record says why.
//                      Calm stone hatch. `absence.nothingHappened` + the reason.
//   2 NeverRecorded    nothing on file, no reason either. Amber, dotted.
//                      Deliberately loud: this is a hole in the ledger, not a
//                      decision somebody made.
//   3 GeneratedStrip   the band has rows but not one of them is a real,
//                      certainly-attributed product row. `mark.testRun` for a
//                      test-run column, `mark.labelOnly` for rows matched by name.
//
//  ROW-level (one canonical step, imported from the contest's runner-up)
//   4 SkippedCell      no event at this step, but the journey went on.
//                      `rail.skipped`. Dashed outline, faint amber.
//   5 NeverReachedTail no event here and none later: the journey ended.
//                      `rail.neverReached`. ONE block running to the foot of
//                      the band, which is what turns a cohort's ragged floor
//                      into a legible funnel.
//
// 4 and 5 are the pair the owner named explicitly ("representation of skipped
// items in table related"), and they must never render alike — one is dashed and
// per-row, the other is a single striped block with a printed label.

import { useTranslations } from "next-intl";
import { META_LABEL, NOTICE } from "@/app/_components/ui/recipes";
import { NEVER_RECORDED_FILL, NEVER_REACHED_FILL, VOID_HATCH } from "./journeyMarks";

/** 1 — "Nothing happened here" over the phase's own reason. */
export function NothingHappened({ reasonKey, height }: { reasonKey: string; height: number }) {
  const t = useTranslations("journey");
  type Key = Parameters<typeof t>[0];
  const key = reasonKey as Key;
  return (
    <div className={`${VOID_HATCH} shrink-0 overflow-hidden px-2 py-2`} style={{ height }}>
      <div className="rounded-md border border-stone-300 bg-white/90 p-2">
        <p className={META_LABEL}>{t("absence.nothingHappened")}</p>
        {t.has(key) ? <p className="mt-1 text-micro leading-snug text-ink">{t(key)}</p> : null}
      </div>
    </div>
  );
}

/** 2 — nothing on file and nothing to explain it. */
export function NeverRecorded({ height }: { height: number }) {
  const t = useTranslations("journey");
  return (
    <div
      className={`${NEVER_RECORDED_FILL} shrink-0 overflow-hidden border-y border-dashed border-dial-amber px-2 py-2`}
      style={{ height }}
    >
      <p className={`${NOTICE("amber")} border-dashed p-2 text-micro leading-snug`}>
        {t("absence.neverRecorded")}
      </p>
    </div>
  );
}

/** 3 — the band holds rows, but the ledger vouches for none of them. */
export function GeneratedStrip({ height, reasonKey }: { height: number; reasonKey: "mark.testRun" | "mark.labelOnly" }) {
  const t = useTranslations("journey");
  return (
    <div
      className={`${NOTICE("amber")} flex shrink-0 items-center gap-2 overflow-hidden rounded-none border-x-0 border-t-0 border-b border-dashed px-2 text-micro leading-snug`}
      style={{ height }}
    >
      <span className="h-2 w-2 shrink-0 rotate-45 border border-dashed border-dial-amber" aria-hidden="true" />
      <span>{t(reasonKey)}</span>
    </div>
  );
}

/** 4 — this step did not happen, and the journey carried on regardless. */
export function SkippedCell({ height }: { height: number }) {
  const t = useTranslations("journey");
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden border-b border-stone-200 px-2"
      style={{ height }}
    >
      <span
        className={`${NOTICE("amber")} flex h-full w-full items-center justify-center rounded-sm border-dashed opacity-75`}
        aria-hidden="true"
      >
        <span className="h-0 w-6 border-t border-dashed border-dial-amber" />
      </span>
      {/* Not hover-only, and not colour-only: the dashed box is the visible
          mark, this is the same fact for a screen reader and for touch. */}
      <span className="sr-only">{t("rail.skipped")}</span>
    </div>
  );
}

/** 5 — the journey ended before this point. One block, one printed label. */
export function NeverReachedTail({ height }: { height: number }) {
  const t = useTranslations("journey");
  return (
    <div
      className={`${NEVER_REACHED_FILL} flex shrink-0 justify-center overflow-hidden border-t border-stone-300 px-3 pt-3`}
      style={{ height }}
    >
      <p className="max-w-[12rem] text-center text-micro leading-snug text-steel">{t("rail.neverReached")}</p>
    </div>
  );
}
