"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/app/_components/Badge";
import { Tooltip } from "@/app/_components/Tooltip";
import { ColumnHead } from "@/app/_components/table/ColumnHead";
import { TableStatus } from "@/app/_components/table/TableStatus";
import { useTableSort, type SortAccessors } from "@/app/_components/table/useTableSort";
import { STICKY_HEAD } from "@/app/_components/ui/recipes";
import type { PauseReason, SourceRunSummary } from "@/app/_lib/jobseeker/types";

// ONE scan run, unrolled per source.
//
// Its own component because the sort engine is a HOOK: the history renders a table per
// run, and a hook cannot be called inside that map. Extracting the table is what lets
// each one own its ordering honestly instead of every run sharing one, or none sorting
// at all.
//
// It was six hand-written `<th scope="col" className="py-1 pr-3 font-medium">` — with
// `nums` on the HEADER cells, where there is no number — and no `aria-sort` anywhere.
// `ColumnHead` renders the `<th>` itself precisely so those cannot be omitted;
// `useTableSort` pins a missing value last in BOTH directions; `TableStatus` is the
// sr-only region that says a re-sort happened at all.

const OUTCOME_TONE: Record<SourceRunSummary["outcome"], "positive" | "caution" | "critical" | "neutral"> = {
  succeeded: "positive",
  collapsed: "caution",
  blocked: "caution",
  offline: "neutral",
  failed: "critical",
  skipped: "neutral",
};

type Col = "source" | "outcome" | "new" | "changed" | "absent";

export function ScanRunTable({
  rows,
  labels,
  pausedById,
}: {
  rows: readonly SourceRunSummary[];
  /** sourceId → catalog label. A missing entry means the source read failed; the id
   *  is then printed, and the page above says why. */
  labels: Map<string, string>;
  pausedById: Map<string, PauseReason>;
}) {
  const t = useTranslations("me.scans");
  const tSources = useTranslations("me.sources");
  const nameOf = (s: SourceRunSummary) => labels.get(s.sourceId) ?? s.sourceId;
  const accessors: SortAccessors<SourceRunSummary, Col> = {
    source: nameOf,
    outcome: (s) => s.outcome,
    new: (s) => s.new,
    changed: (s) => s.changed,
    absent: (s) => s.absent,
  };
  const { sorted, sort, toggle } = useTableSort<SourceRunSummary, Col>(rows, accessors, { col: "source", dir: "asc" });
  const COL_TITLE: Record<Col, string> = {
    source: t("table.source"),
    outcome: t("table.outcome"),
    new: t("table.new"),
    changed: t("table.changed"),
    absent: t("table.absent"),
  };

  return (
    <>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr>
            <ColumnHead title={COL_TITLE.source} sortCol="source" sort={sort} onSort={toggle} className={STICKY_HEAD("head")} />
            <ColumnHead title={COL_TITLE.outcome} sortCol="outcome" sort={sort} onSort={toggle} className={STICKY_HEAD("head")} />
            <ColumnHead title={COL_TITLE.new} sortCol="new" sort={sort} onSort={toggle} align="right" className={STICKY_HEAD("head")} />
            <ColumnHead title={COL_TITLE.changed} sortCol="changed" sort={sort} onSort={toggle} align="right" className={STICKY_HEAD("head")} />
            <ColumnHead title={COL_TITLE.absent} sortCol="absent" sort={sort} onSort={toggle} align="right" className={STICKY_HEAD("head")} />
            <ColumnHead title={t("table.reason")} sort={sort} onSort={toggle} className={STICKY_HEAD("head")} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => {
            const attention = s.outcome === "blocked" || s.outcome === "collapsed";
            const paused = pausedById.get(s.sourceId);
            return (
              <tr key={s.sourceId} className="border-t border-stone-200 align-top transition-colors hover:bg-paper/70">
                <td className="py-1 pr-3 text-ink">{nameOf(s)}</td>
                <td className="py-1 pr-3">
                  <Badge tone={OUTCOME_TONE[s.outcome]} label={tSources(`outcome.${s.outcome}`)} />
                </td>
                {/* `nums` on the body cells, which is where the numbers are. */}
                <td className="nums py-1 pr-3 text-right text-ink">{s.new}</td>
                <td className="nums py-1 pr-3 text-right text-ink">{s.changed}</td>
                <td className="nums py-1 pr-3 text-right text-ink">{s.absent}</td>
                <td className="py-1 text-steel">
                  {attention ? (
                    // A state, as a pill with the pause reason in its tooltip — not an
                    // amber paragraph painted over the cell.
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <Tooltip label={paused ? tSources("pausedShort", { reason: tSources(`pauseReason.${paused}`) }) : (s.reason ?? "")} side="left">
                        <Badge tone="caution" label={s.reason ?? tSources("pausedPill")} />
                      </Tooltip>
                      <Link href="/me/sources" className="focus-ring rounded underline">
                        {t("table.resumeLink")}
                      </Link>
                    </span>
                  ) : (
                    (s.reason ?? "")
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <TableStatus columnTitle={COL_TITLE[sort.col]} dir={sort.dir} />
    </>
  );
}
