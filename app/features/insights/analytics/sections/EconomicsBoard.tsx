"use client";

// VARIANT C — "Efficiency board". Metaphor: one comparison matrix.
//
// Today the page carries THREE acquisition tables with three different
// taxonomies — first-touch source, stored channel, and per-creative variant —
// each in its own panel with its own columns. A reader who wants "which of my
// acquisition surfaces is most efficient" has to hold three tables in their head
// and normalise the columns themselves. This variant makes that comparison the
// page's job: every surface is a row with the same unit-economics columns, in
// one sortable table.
//
// THE RISK, stated up front because it decides whether this direction ships:
// those three taxonomies are genuinely different measurements — `bySource`
// derives origin from each entry's earliest event, `byChannel` groups the stored
// source_channel, and variants are creatives WITHIN a channel. The existing
// panels name each honestly and the code comments warn against conflating them.
// So the rows here are GROUPED and labelled by taxonomy, never silently merged,
// and the group label is part of the row's identity. If a reader still reads the
// table as one flat ranking, this direction is wrong and the panels should stay
// separate.
import { useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowRight, PauseCircle } from "lucide-react";
import { useNumberFormat } from "@/app/_lib/use-number-format";
import { labelOr } from "@/app/_lib/use-enum-label";
import { PANEL } from "@/app/_components/ui/recipes";
import { Defer } from "@/app/_components/ui/Defer";
import { ColumnHead } from "@/app/_components/table/ColumnHead";
import { useTableSort } from "@/app/_components/table/useTableSort";
import { PipelineShapeBar } from "@/app/_components/ui/PipelineShapeBar";
import { AutomationPanel, ComputeCostPanel } from "./sectionChunks";
import { SpendInput } from "../AnalyticsChannelSpendInput";
import { buildTabSwitchUrl, buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import type { EconomicsProps } from "./economicsTypes";
import { economicsRows, type EconomicsKind, type EconomicsRow } from "./economicsRows";

// The row model + the one hire-rate rule live in economicsRows.ts, pure, so the
// three taxonomies' normalization can be driven by a test — see the note there.
type Row = EconomicsRow;
type Kind = EconomicsKind;
type Col = "name" | "kind" | "total" | "hired" | "hireRatePct" | "spendCzk" | "costPerHireCzk";

const KIND_CLASS: Record<Kind, string> = {
  channel: "bg-coral/10 text-coral",
  source: "bg-steel/15 text-steel",
  variant: "bg-moss/15 text-moss",
};

export function EconomicsBoard({ data, reload, tabScopedSearch }: EconomicsProps) {
  const t = useTranslations("analytics.econ");
  const tc = useTranslations("analytics.channels");
  const ta = useTranslations("analytics");
  const { money } = useNumberFormat();
  const format = useFormatter();
  const [kindFilter, setKindFilter] = useState<Kind | "">("");

  const channelName = (c: string) => labelOr(tc, `names.${c}`, c);
  const sourceName = (s: string) => labelOr(ta, `source.${s}`, s);
  const shortDate = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "short", year: "numeric" });

  const rows: Row[] = economicsRows(data, { channel: channelName, source: sourceName });

  // UAT KAT-L1-S02 / TOM-ANA-1 — every number on this page has to end in a decision,
  // and the consolidation left the board with eight columns and no way out of them
  // („K čemu mi je graf, ze kterého se nedostanu k lidem?"). A CHANNEL row can hand
  // the reader the exact population it counted: the board's `?source=` filter keys off
  // the same stored `source_channel` this row groups by, so the link reproduces the
  // row and nothing else. The other two taxonomies get NO row link on purpose — the
  // board cannot filter by derived first-touch origin or by creative, and a link that
  // quietly showed a different set of people would be worse than no link. Their exit
  // is the Channels tab in the footer, which is where the pre-consolidation
  // SourcePanel's affordance went.
  const boardHref = (channel: string) =>
    buildUrl({ ...clearedTabScopedParams(), tab: "pipeline", source: channel }, tabScopedSearch);

  const { sorted, sort, toggle } = useTableSort<Row, Col>(
    rows,
    {
      name: (r) => r.name,
      kind: (r) => r.kind,
      total: (r) => r.total,
      hired: (r) => r.hired,
      // A surface with nobody in it has no rate to rank; the value IS null now
      // (economicsRows), so the sorter no longer re-derives the empty case from
      // `total` — that duplicated guard is what let the rendered value lie while
      // the ranking stayed honest.
      hireRatePct: (r) => r.hireRatePct,
      spendCzk: (r) => r.spendCzk,
      costPerHireCzk: (r) => r.costPerHireCzk,
    },
    { col: "total", dir: "desc" }
  );

  const visible = kindFilter ? sorted.filter((r) => r.kind === kindFilter) : sorted;
  const peak = Math.max(1, ...rows.map((r) => r.total));

  return (
    <div className="animate-arrive-in space-y-6">
      <section className={`${PANEL} p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h3 className="font-serif text-h2 text-ink">{t("boardTitle")}</h3>
            <p className="mt-1 max-w-2xl text-sm text-steel">{t("boardIntro")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("boardFilterLabel")}>
            {(["", "channel", "source", "variant"] as const).map((k) => (
              <button
                key={k || "all"}
                type="button"
                onClick={() => setKindFilter(k)}
                aria-pressed={kindFilter === k}
                className={`focus-ring rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${
                  kindFilter === k ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:border-coral/40"
                }`}
              >
                {k === "" ? t("kindAll") : t(`kind_${k}` as "kind_channel")}
              </button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="mt-4 rounded-md bg-paper p-3 text-base text-steel">{t("boardEmpty")}</p>
        ) : (
          // A table forced past the viewport by min-w scrolls inside this div. A bare
          // overflow container is not reachable without a pointer in every browser
          // (current Chrome/Firefox focus scroll containers on their own; Safari does
          // not), so it is a NAMED, focusable region -- which also gives the data
          // surface an accessible name it did not have.
          <div className="mt-4 overflow-x-auto" role="region" tabIndex={0} aria-label={t("boardTitle")}>
            <table aria-label={t("boardTitle")} className="w-full min-w-[52rem] text-base">
              <thead>
                <tr className="border-b border-stone-200">
                  <ColumnHead title={t("colSurface")} sortCol="name" sort={sort} onSort={toggle} />
                  <ColumnHead title={t("colKind")} sortCol="kind" sort={sort} onSort={toggle} />
                  <ColumnHead title={t("colShape")} sort={sort} onSort={toggle} className="w-32" />
                  <ColumnHead title={t("colLeads")} sortCol="total" sort={sort} onSort={toggle} align="right" />
                  <ColumnHead title={ta("colHired")} sortCol="hired" sort={sort} onSort={toggle} align="right" />
                  <ColumnHead title={ta("colHireRate")} sortCol="hireRatePct" sort={sort} onSort={toggle} align="right" />
                  <ColumnHead title={t("colSpend")} sortCol="spendCzk" sort={sort} onSort={toggle} align="right" />
                  <ColumnHead title={t("colPerHire")} sortCol="costPerHireCzk" sort={sort} onSort={toggle} align="right" />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.key} className="border-b border-stone-100 last:border-0 hover:bg-paper/50">
                    <td className="py-2 pr-3 font-medium text-ink">
                      {/* `viewInBoard` is the existing sibling idiom (the role links in
                          AnalyticsByRoleTable), not a new string: one page, one way of
                          saying "these are the people behind this number". */}
                      {r.channelId ? (
                        <Link
                          href={boardHref(r.channelId)}
                          title={ta("viewInBoard")}
                          className="focus-ring inline-flex items-center gap-1 rounded-sm hover:text-coral hover:underline"
                        >
                          {r.name} <ArrowRight size={12} aria-hidden />
                        </Link>
                      ) : (
                        r.name
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {/* The taxonomy is part of the row's identity, not a
                          decoration: without it the table reads as one flat
                          ranking across three different measurements. */}
                      <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${KIND_CLASS[r.kind]}`}>
                        {t(`kind_${r.kind}` as "kind_channel")}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <PipelineShapeBar
                        label={r.name}
                        total={r.total}
                        reachedInterview={r.reachedInterview}
                        hired={r.hired}
                        peak={peak}
                      />
                    </td>
                    <td className="py-2 pr-3 text-right text-ink nums">{r.total}</td>
                    <td className="py-2 pr-3 text-right font-semibold text-ink nums">{r.hired}</td>
                    <td className="py-2 pr-3 text-right nums">
                      {/* The SAME absent marker the roles table prints for the same
                          situation (AnalyticsByRoleTable) — one page, one answer to
                          "we have no data". Keyed off the value, not off `total`. */}
                      {r.hireRatePct == null ? (
                        <span className="text-steel">—</span>
                      ) : (
                        <span className={r.hired > 0 ? "font-semibold text-moss" : "text-steel"}>{r.hireRatePct}%</span>
                      )}
                    </td>
                    {/* UAT KAT-ANA-2 — the ONLY write path to channel_spend in the
                        product. It lived in ChannelEconomicsPanel, which the section
                        consolidation stopped importing, so the column below kept
                        dividing by a figure nobody could reach: on the seeded host,
                        one row entered six weeks earlier still rendered as
                        `833 CZK / hire`. Lifted INTO the board rather than re-importing
                        the old panel — the board is the surface that renders the
                        number, a second channel table beside it would undo the
                        consolidation (§2.25), and the editor belongs where the figure
                        it feeds is read. */}
                    <td className="py-2 pr-3 text-right nums">
                      {r.channelId ? (
                        <SpendInput channel={r.channelId} channelLabel={r.name} value={r.spendCzk} onSaved={reload} />
                      ) : (
                        <span className="text-steel">—</span>
                      )}
                    </td>
                    <td className="py-2 text-right nums">
                      {r.costPerHireCzk != null ? (
                        <>
                          <span className="font-semibold text-ink">{money(r.costPerHireCzk)}</span>
                          {/* The figure is this one stored row divided by a hire count,
                              so it is exactly as current as the row. Without the date a
                              fossil reads as this period's cost — which is the whole
                              defect, not a footnote to it. */}
                          {r.spendUpdatedAt ? (
                            <span className="block text-xs font-normal text-steel">
                              {ta("spendAsOf", { date: shortDate(r.spendUpdatedAt) })}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-steel">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {visible.length === 0 && rows.length > 0 ? (
          <p className="py-6 text-center text-base text-steel">{t("boardNoMatches")}</p>
        ) : null}

        {/* UAT KAT-ANA-3 — the variant list is capped server-side like byJob is, and
            unlike byJob it said so nowhere. Same key, same idiom as AnalyticsByRoleTable:
            a table that silently drops rows reads as a complete list. */}
        {data.byVariantTotal > data.byVariant.length ? (
          <p className="mt-3 text-meta uppercase text-steel">
            {tc("topByVolume", { shown: data.byVariant.length, total: data.byVariantTotal })}
          </p>
        ) : null}

        {/* UAT KAT-ANA-3 — `variantRecommendations` is the one "pause this creative on
            Monday" action the surface computes, and it has been rendered nowhere since
            the board replaced ChannelEconomicsPanel. A recommendation only: nothing is
            paused automatically, and the note says so. */}
        {data.variantRecommendations.length > 0 ? (
          <div className="mt-4 rounded-md border border-dial-amber/40 bg-dial-amber/10 p-3">
            <p className="flex items-center gap-1.5 text-meta font-semibold uppercase tracking-wide text-ink">
              <PauseCircle size={13} aria-hidden /> {tc("pauseTitle")}
            </p>
            <ul className="mt-1.5 space-y-1">
              {data.variantRecommendations.map((r) => (
                <li key={`${r.campaign ?? ""}:${r.variant}`} className="max-w-prose text-sm text-ink">
                  {tc.rich("pauseLine", {
                    b: (c) => <b className="font-semibold">{c}</b>,
                    variant: r.variant,
                    campaign: r.campaign ?? "",
                    job: r.jobTitle ?? "",
                    sharePct: r.leadSharePct,
                    groupTotal: r.groupTotal,
                  })}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 max-w-prose text-sm text-steel">{tc("pauseNote")}</p>
          </div>
        ) : null}

        {/* Says out loud that a dash in Spend is a measurement boundary, not a
            zero — the single most misreadable cell on this table. */}
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-t border-stone-200 pt-3">
          <p className="max-w-2xl text-sm text-steel">{t("boardSpendNote")}</p>
          {/* The acquisition story's other exit, carried over from the panel this
              board replaced: where channels are actually configured. */}
          <Link
            href={buildTabSwitchUrl("channels", tabScopedSearch)}
            className="focus-ring inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-coral hover:underline"
          >
            {ta("configureChannels")} <ArrowRight size={13} aria-hidden />
          </Link>
        </div>
      </section>

      <Defer strategy="idle">
        <AutomationPanel
          impact={data.automation}
          roi={data.automationRoi}
          costPerHireCzk={data.costPerHireCzk}
          timeToHireDays={data.medianTimeToHireDays}
          onSaved={reload}
          decisionsHref={buildUrl({ ...clearedTabScopedParams(), tab: "decisions" }, tabScopedSearch)}
        />
      </Defer>

      <Defer strategy="visible">
        <ComputeCostPanel
          computeCost={data.computeCost}
          costPerHireCzk={data.costPerHireCzk}
          // UAT KAT-ANA-2 — the blended manual figure carries the date of the OLDEST
          // spend entry behind it; a blend is only as current as its stalest input.
          costPerHireAsOf={data.costPerHireAsOf ?? null}
          windowed={data.windowDays != null}
        />
      </Defer>

      {/* UAT KAT-ANA-11 — the analytics criterion is "what / by whom / cost", and the
          third leg had no path from here. Both audit tables carry what and by whom;
          this section carries two cost AGGREGATES (CZK channel spend, USD compute) and
          named nowhere to go for the breakdown. Billing's spend panel attributes the
          compute figure per use case against the plan allowance, so the two halves of
          "what did it cost" now meet on one path.
          Deliberately NOT a per-decision cost column: `llm_usage.request_id` is never
          joined to a pipeline event, and an unlabelled number on a decision row would
          be the LLM slice of that decision's cost reading as the whole of it.
          G7 holds — this adds a navigation exit, not a number. Nothing here converts,
          sums or compares the USD ledger against the CZK channel spend, and the note
          says which of the two Billing actually breaks down. Placed under the compute
          panel (the figure it speaks about) rather than in the acquisition footer, so
          it can never read as a total of both. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-t border-stone-200 pt-3">
        <p className="max-w-2xl text-sm text-steel">{t("billingNote")}</p>
        <Link
          href={buildTabSwitchUrl("billing", tabScopedSearch)}
          className="focus-ring inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-coral hover:underline"
        >
          {t("billingLink")} <ArrowRight size={13} aria-hidden />
        </Link>
      </div>
    </div>
  );
}
