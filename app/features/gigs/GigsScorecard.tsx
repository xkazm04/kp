"use client";

import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { useTranslations } from "next-intl";
import { META_LABEL, PANEL, PANEL_SUNKEN, STICKY_HEAD } from "@/app/_components/ui/recipes";
import { GIG_ARENAS, type Gig, type GigArena, type GigAttempt, type GigKpi, type GigKpiCell } from "@/app/_lib/gigs/types";
import { overallCell, type SpecialistRow } from "./gigsLogic";
import { Absent } from "./GigsFacts";
import { MarkLegend, MarkRow, RateLine, sentMarks } from "./GigsMarks";
import { useGigsFormat } from "./useGigsFormat";

// The scorecard, as a full page: the accepted-outcome rate by arena and by specialist,
// the money won per currency, and the disclosure rate. Accepted over resolved, pending
// beside the rate and never inside it, every percentage carrying its n and a small
// sample flagged as one. Read from GET /api/gigs/kpi - the server's own fold, re-read
// after every verdict the tab records. Opened from the line's terminus (on an arena) or
// a specialist edge; the row it was opened on is marked and brought into view.

export function GigsScorecard({
  kpi,
  gigs,
  attemptsByGig,
  specialists,
  focus,
}: {
  kpi: GigKpi | null;
  gigs: readonly Gig[];
  attemptsByGig: Readonly<Record<string, GigAttempt>>;
  specialists: readonly SpecialistRow[];
  /** The arena or specialist id the page was opened on, if any. */
  focus: { arena?: GigArena; specialistId?: string } | null;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const focusRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: "center" });
  }, [focus]);

  if (!kpi) return <p className="text-sm text-steel">{t("scorecard.loading")}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-h2 text-ink">{t("scorecard.title")}</h2>
        <p className="mt-1 max-w-3xl text-sm text-steel">{t("scorecard.lede")}</p>
        <div className="mt-2">
          <MarkLegend />
        </div>
      </div>

      <section>
        <h3 className={`${META_LABEL} mb-2`}>{t("scorecard.byArena")}</h3>
        <ScoreTable>
          {GIG_ARENAS.map((a) => (
            <ScoreRow
              key={a}
              label={fmt.arena(a)}
              cell={kpi.byArena[a]}
              marks={<MarkRow marks={sentMarks(gigs, attemptsByGig, (g) => g.arena === a)} emptyLabel={t("scorecard.nothingSent")} />}
              focused={focus?.arena === a}
              rowRef={focus?.arena === a ? focusRef : undefined}
            />
          ))}
          <ScoreRow label={t("scorecard.allArenas")} cell={overallCell(kpi)} marks={<MarkRow marks={sentMarks(gigs, attemptsByGig)} emptyLabel={t("scorecard.nothingSent")} />} total />
        </ScoreTable>
      </section>

      <section>
        <h3 className={`${META_LABEL} mb-2`}>{t("scorecard.bySpecialist")}</h3>
        {specialists.length === 0 ? (
          <p className={`${PANEL_SUNKEN} px-4 py-3 text-sm text-steel`}>{t("scorecard.noSpecialists")}</p>
        ) : (
          <ScoreTable>
            {specialists.map((s) => (
              <ScoreRow
                key={s.id}
                label={s.name}
                cell={kpi.bySpecialist[s.id]}
                marks={<MarkRow marks={sentMarks(gigs, attemptsByGig, (_g, at) => at.specialistId === s.id)} emptyLabel={t("scorecard.nothingSent")} />}
                focused={focus?.specialistId === s.id}
                rowRef={focus?.specialistId === s.id ? focusRef : undefined}
              />
            ))}
          </ScoreTable>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className={`${META_LABEL} mb-2`}>{t("scorecard.moneyWon")}</h3>
          <div className={`${PANEL} p-4`}>
            {kpi.moneyWon.length === 0 ? (
              <p className="text-sm text-steel">{t("scorecard.noMoney")}</p>
            ) : (
              <ul className="space-y-1">
                {kpi.moneyWon.map((m) => (
                  <li key={m.currency ?? "none"} className="flex items-baseline justify-between gap-3 nums">
                    <span className="font-semibold text-ink">{fmt.money(m.amount, m.currency)}</span>
                    <span className="text-sm text-steel">{t("scorecard.moneyCount", { count: m.count })}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-sm text-steel">{t("scorecard.noTotal")}</p>
            {kpi.acceptedWithoutAmount > 0 ? <p className="mt-1 text-sm text-steel">{t("scorecard.acceptedNoAmount", { count: kpi.acceptedWithoutAmount })}</p> : null}
          </div>
        </section>
        <section>
          <h3 className={`${META_LABEL} mb-2`}>{t("scorecard.disclosureTitle")}</h3>
          <div className={`${PANEL} p-4 text-sm`}>
            <p className="text-ink">
              {kpi.disclosureRate === null ? t("scorecard.disclosureNone") : t("scorecard.disclosure", { percent: fmt.percent(Math.round(kpi.disclosureRate * 100)) })}
            </p>
            <p className="mt-1 text-steel">{t("scorecard.disclosureNote")}</p>
          </div>
        </section>
      </div>
      <p className="text-sm text-steel">{t("scorecard.computedAt", { date: fmt.dateTime(kpi.computedAt) })}</p>
    </div>
  );
}

function ScoreTable({ children }: { children: ReactNode }) {
  const t = useTranslations("gigs");
  return (
    <div className={`${PANEL} overflow-x-auto`}>
      <table className="w-full min-w-[44rem] text-left text-sm">
        <thead>
          <tr>
            <th scope="col" className={`${STICKY_HEAD()} px-3 py-2 ${META_LABEL}`}>
              {t("scorecard.col.cell")}
            </th>
            <th scope="col" className={`${STICKY_HEAD()} px-3 py-2 ${META_LABEL}`}>
              {t("scorecard.col.rate")}
            </th>
            <th scope="col" className={`${STICKY_HEAD()} px-3 py-2 ${META_LABEL}`}>
              {t("scorecard.col.marks")}
            </th>
            <th scope="col" className={`${STICKY_HEAD()} px-3 py-2 text-right ${META_LABEL}`}>
              {t("scorecard.col.costPerAccepted")}
            </th>
            <th scope="col" className={`${STICKY_HEAD()} px-3 py-2 text-right ${META_LABEL}`}>
              {t("scorecard.col.costUnreported")}
            </th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function ScoreRow({
  label,
  cell,
  marks,
  total = false,
  focused = false,
  rowRef,
}: {
  label: string;
  cell: GigKpiCell | undefined;
  marks: ReactNode;
  total?: boolean;
  focused?: boolean;
  rowRef?: Ref<HTMLTableRowElement>;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  return (
    <tr ref={rowRef} aria-current={focused ? "true" : undefined} className={`border-t border-stone-200 align-top ${total ? "bg-stone-50" : ""} ${focused ? "bg-coral/5 outline outline-2 -outline-offset-2 outline-coral dark:bg-coral/10" : ""}`}>
      <th scope="row" className="px-3 py-2 font-semibold text-ink">
        {label}
      </th>
      <td className="px-3 py-2">
        <RateLine cell={cell} />
      </td>
      <td className="px-3 py-2">{marks}</td>
      <td className="px-3 py-2 text-right nums">
        {total ? <Absent>{t("scorecard.seeRows")}</Absent> : cell?.costPerAcceptedUsd == null ? <Absent>{t("scorecard.na")}</Absent> : fmt.usd(cell.costPerAcceptedUsd)}
      </td>
      <td className="px-3 py-2 text-right nums">{cell?.costUnreported ?? 0}</td>
    </tr>
  );
}
