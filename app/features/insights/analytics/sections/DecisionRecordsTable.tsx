"use client";

// The sealed decision chain as a TABLE: sortable headers, header-cell filters,
// and a pager — replacing the unbounded `<ul>` that rendered every record at
// once (a 66-record chain made the section ~9,000px tall, and a real chain is
// far longer).
//
// CLIENT-side here, unlike the decision log beside it. /api/decisions/records
// returns the WHOLE chain in one response — it has to, because verifying
// tamper-evidence means walking every link — so the rows are already in memory
// and paging them is a slice, exactly the case TablePager documents itself for.
//
// One rule this table must not break: `seq` is the chain's own order, and the
// hash of each link is computed over the one before it. So the DEFAULT ordering
// stays seq-descending (newest link first) and sorting by another column is a
// VIEW over the chain, never a claim about the chain itself — the seq column
// stays visible in every ordering so the reader can always see the real position.
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { labelize } from "@/app/_lib/format";
import { ColumnFilter } from "@/app/_components/table/ColumnFilter";
import { ColumnHead } from "@/app/_components/table/ColumnHead";
import { clampPage, pageSlice, TablePager } from "@/app/_components/table/TablePager";
import { useTableSort } from "@/app/_components/table/useTableSort";
import type { DecisionRecord } from "@/app/_lib/decision-record-store";

type Col = "seq" | "kind" | "actor" | "createdAt";

export function DecisionRecordsTable({
  records,
  resolved,
  rationaleOf,
  boardHref,
}: {
  records: DecisionRecord[];
  resolved: Record<string, { label: string; live: boolean }> | undefined;
  /** Localized rationale, resolved by the panel (it owns the wave catalog). */
  rationaleOf: (r: DecisionRecord) => string;
  boardHref: (q: string) => string;
}) {
  const t = useTranslations("analytics.decisionRecords");
  const [kind, setKind] = useState("");
  const [actor, setActor] = useState("");
  const [page, setPage] = useState(0);

  const { sorted, sort, toggle } = useTableSort<DecisionRecord, Col>(
    records,
    {
      seq: (r) => r.seq,
      kind: (r) => r.kind,
      actor: (r) => r.actor,
      createdAt: (r) => r.createdAt,
    },
    { col: "seq", dir: "desc" }
  );

  const filtered = sorted.filter((r) => (!kind || r.kind === kind) && (!actor || r.actor === actor));
  const safePage = clampPage(page, filtered.length);
  const shown = pageSlice(filtered, safePage);

  // Facets from the FULL set, not the filtered view, so the option list doesn't
  // shrink as you narrow and strand the reader with no way back.
  const kindOptions = [...new Set(records.map((r) => r.kind))]
    .sort()
    .map((v) => ({ value: v, label: labelize(v) }));
  const actorOptions = [...new Set(records.map((r) => r.actor))].sort().map((v) => ({ value: v, label: v }));

  const onFilter = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(0);
  };

  return (
    <>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[46rem] text-base">
          <thead>
            <tr className="border-b border-stone-200">
              <ColumnHead title={t("colSeq")} sortCol="seq" sort={sort} onSort={toggle} align="right" />
              <ColumnHead title={t("colKind")} sortCol="kind" sort={sort} onSort={toggle}>
                <ColumnFilter title={t("colKind")} trigger="icon" value={kind} onChange={onFilter(setKind)} options={kindOptions} />
              </ColumnHead>
              <ColumnHead title={t("colSubject")} sort={sort} onSort={toggle} />
              <ColumnHead title={t("colRationale")} sort={sort} onSort={toggle} />
              <ColumnHead title={t("colActor")} sortCol="actor" sort={sort} onSort={toggle}>
                <ColumnFilter title={t("colActor")} trigger="icon" value={actor} onChange={onFilter(setActor)} options={actorOptions} />
              </ColumnHead>
              <ColumnHead title={t("colSealed")} sortCol="createdAt" sort={sort} onSort={toggle} />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const subject = resolved?.[r.candidateRef];
              return (
                <tr key={r.seq} className="border-b border-stone-100 align-top last:border-0 hover:bg-paper/50">
                  {/* The chain position, always shown: sorting by another column
                      reorders the VIEW, and without seq on screen the reader
                      could mistake that view for the chain's own order. */}
                  <td className="whitespace-nowrap py-2 pr-3 text-right font-mono text-sm text-steel nums">#{r.seq}</td>
                  <td className="py-2 pr-3 font-medium text-ink">{labelize(r.kind)}</td>
                  <td className="py-2 pr-3">
                    {subject?.live ? (
                      <Link
                        href={boardHref(subject.label)}
                        className="focus-ring rounded text-ink underline-offset-2 hover:text-coral hover:underline"
                      >
                        {subject.label}
                      </Link>
                    ) : (
                      // A record outlives the entry it concerns, so an
                      // unresolvable ref is normal — shown as plain text, never
                      // as a dead link.
                      <span className="text-steel">{subject?.label ?? r.candidateRef}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-sm text-steel">
                    <span className="line-clamp-2">{rationaleOf(r)}</span>
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 font-mono text-sm text-steel">{r.actor}</td>
                  <td className="whitespace-nowrap py-2 text-sm text-steel nums">
                    {r.createdAt.slice(0, 16).replace("T", " ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-base text-steel">{t("noMatches")}</p>
      ) : (
        <div className="mt-3">
          <TablePager page={safePage} total={filtered.length} onPage={setPage} />
        </div>
      )}
    </>
  );
}
