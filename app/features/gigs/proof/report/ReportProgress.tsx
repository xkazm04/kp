"use client";

import { useTranslations } from "next-intl";
import type { GigPlanRow } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../data/useGigsFormat";
import { milestoneRows, milestoneTotals } from "../../logic/pairing";
import { MilestoneList } from "../panels/MilestoneList";
import { Figure, StatCard } from "./parts";

// Section 4, progress (once the gig is paired): the accepted plan followed as a Personas
// milestone. The whole as one big percentage, the goals done as a count, then every step as
// a goal with its status pill and its bar (MilestoneList.tsx, shared with the Pairing tab).
// A step nobody reported on is open at 0, never guessed forward (logic/pairing.ts).

export function ReportProgress({ accepted, figure }: { accepted: GigPlanRow; figure: number }) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const rows = milestoneRows(accepted);
  const totals = milestoneTotals(rows);
  const progress = accepted.progress;
  const updated = progress?.updatedAt ? t("pairing.updated", { when: fmt.dateTime(progress.updatedAt) }) : t("report.progress.noReport");
  const blocked = rows.filter((r) => r.status === "blocked").length;
  return (
    <>
      <div className="rp-stats is-three">
        <StatCard value={t("pairing.pct", { pct: totals.pct })} label={t("report.progress.whole")} caption={updated} tone={totals.pct === 100 ? "moss" : undefined}>
          <span className="ms-track" role="img" aria-label={t("pairing.wholeAria", { pct: totals.pct })}>
            <i style={{ width: `${totals.pct}%` }} />
          </span>
        </StatCard>
        <StatCard value={t("report.progress.ofTotal", { done: totals.done, total: totals.total })} label={t("report.progress.goalsDone")} caption={t("report.progress.goalsCaption")} />
        <StatCard value={fmt.number(blocked)} label={t("report.progress.blocked", { count: blocked })} caption={progress && progress.milestoneId === null ? t("pairing.localOnly") : t("report.progress.blockedCaption")} tone={blocked ? "coral" : undefined} />
      </div>
      <Figure n={figure} what={t("report.progress.caption", { count: rows.length })} source={t("report.progress.source")}>
        {rows.length ? <MilestoneList rows={rows} pct={totals.pct} updated={null} localOnly={false} whole={false} /> : <p className="panel-empty">{t("pairing.noMilestone")}</p>}
      </Figure>
    </>
  );
}
