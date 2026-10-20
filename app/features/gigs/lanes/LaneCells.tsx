"use client";

import { useTranslations } from "next-intl";
import { Tooltip } from "@/app/_components/Tooltip";
import { type LaneCell, YOUR_STEPS } from "../logic/lanes";
import { type AttemptTally, nicheTally } from "../logic/niches";
import type { SpecialistRow } from "../logic/wire";
import { useGigsFormat } from "../data/useGigsFormat";

// The lanes' cells (GigsLanes.tsx): the key that explains them, one stage cell per step,
// and a type's agent record and cost.

/** The key above the lanes: the four ways a cell reads. */
export function LaneKey() {
  const t = useTranslations("gigs");
  return (
    <p className="zkey">
      <span>
        <i className="mk ok" aria-hidden /> {t("lanes.keyAtWork")}
      </span>
      <span>
        <i className="mk fail" aria-hidden /> {t("lanes.keyFailed")}
      </span>
      <span>
        <span className="key-dot" aria-hidden>
          ·
        </span>{" "}
        {t("lanes.keyNoneNow")}
      </span>
      <span>
        <span className="key-slot" aria-hidden /> {t("lanes.keyNever")}
      </span>
    </p>
  );
}

export function StageCell({ cell, total, where, onOpen }: { cell: LaneCell; total: number; where: string; onOpen: () => void }) {
  const t = useTranslations("gigs");
  const now = YOUR_STEPS.has(cell.step);
  const cls = `cell${now ? " nowcol" : ""}`;
  if (cell.count > 0) {
    const share = total ? Math.round((cell.count / total) * 100) : 0;
    const sentence = t("lanes.cellCount", { where, count: cell.count, share, now: now ? "yes" : "no" });
    return (
      <Tooltip label={sentence} className="gd-tipcell">
        <button type="button" className={cls} aria-label={sentence} onClick={onOpen}>
          <span className="num">{cell.count}</span>
          <span className="bar" aria-hidden>
            <i style={{ width: `${Math.max(3, share)}%` }} />
          </span>
        </button>
      </Tooltip>
    );
  }
  let kind: "zero" | "stub" | "empty" | "never";
  if (cell.step === "sent") kind = "zero";
  else if (cell.step === "verdict") kind = "stub";
  else kind = cell.reached ? "empty" : "never";
  const sentence = t(`lanes.cell_${kind}`, { where });
  return (
    <Tooltip label={sentence} className="gd-tipcell">
      <span className={`${cls} ${kind}`} role="img" aria-label={sentence} tabIndex={0}>
        {kind === "zero" ? (
          <>
            <span className="num">0</span>
            <span className="bar" aria-hidden />
          </>
        ) : kind === "empty" ? (
          <span className="num">·</span>
        ) : (
          <span className="slot" aria-hidden>
            —
          </span>
        )}
      </span>
    </Tooltip>
  );
}

/** A type's record: every run of its gig agents (one persona per gig, so each run belongs
 *  to exactly one type), the failed share, revisions, and the cost they reported. Niche
 *  specialists' runs span types and are not split here (GigsLanes' note says so). */
export function TypeRecord({ personas, tallies }: { personas: readonly SpecialistRow[]; tallies: Readonly<Record<string, AttemptTally>> | null }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const tally = nicheTally({ hires: [...personas] }, tallies);
  const failed = tally.byStatus.failed ?? 0;
  const revised = tally.byStatus.revision_requested ?? 0;
  const share = tally.attempts ? Math.round((failed / tally.attempts) * 100) : 0;
  return (
    <>
      <div className="failbar" role="cell">
        {tallies === null ? (
          <span className="t">{t("lanes.attemptsLoading")}</span>
        ) : tally.attempts === 0 ? (
          <span className="t">{t("lanes.noRuns")}</span>
        ) : (
          <>
            <span className="t">{t.rich("lanes.failedOf", { failed, attempts: tally.attempts, b: (c) => <b>{c}</b> })}</span>
            <span className="b" role="img" aria-label={t("lanes.failedShare", { share })}>
              <i style={{ width: `${share}%` }} />
            </span>
            <span className="t">{t("lanes.revised", { count: revised })}</span>
          </>
        )}
      </div>
      <div className="money" role="cell">
        {tallies === null || tally.attempts === 0 ? (
          <span className="l">—</span>
        ) : (
          <>
            <span className="num">{fmt.usd(tally.costUsd)}</span>
            <span className="l">{tally.costUnreported > 0 ? t("lanes.costUnreported", { count: tally.costUnreported }) : t("lanes.costAllReported")}</span>
          </>
        )}
      </div>
    </>
  );
}
