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
import { useTranslations } from "next-intl";
import { useNumberFormat } from "@/app/_lib/use-number-format";
import { labelOr } from "@/app/_lib/use-enum-label";
import { PANEL } from "@/app/_components/ui/recipes";
import { Defer } from "@/app/_components/ui/Defer";
import { ColumnHead } from "@/app/_components/table/ColumnHead";
import { useTableSort } from "@/app/_components/table/useTableSort";
import { PipelineShapeBar } from "@/app/_components/ui/PipelineShapeBar";
import { AutomationPanel, ComputeCostPanel } from "./sectionChunks";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import type { EconomicsProps } from "./economicsTypes";

type Kind = "channel" | "source" | "variant";
type Row = {
  key: string;
  kind: Kind;
  name: string;
  total: number;
  reachedInterview: number;
  hired: number;
  hireRatePct: number;
  spendCzk: number | null;
  costPerHireCzk: number | null;
};
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
  const [kindFilter, setKindFilter] = useState<Kind | "">("");

  const channelName = (c: string) => labelOr(tc, `names.${c}`, c);
  const sourceName = (s: string) => labelOr(ta, `source.${s}`, s);

  const rows: Row[] = [
    ...data.byChannel.map((r) => ({
      key: `channel:${r.channel}`,
      kind: "channel" as const,
      name: channelName(r.channel),
      total: r.total,
      reachedInterview: r.reachedInterview,
      hired: r.hired,
      hireRatePct: r.hireRatePct,
      spendCzk: r.spendCzk,
      costPerHireCzk: r.costPerHireCzk,
    })),
    ...data.bySource.map((r) => ({
      key: `source:${r.source}`,
      kind: "source" as const,
      name: sourceName(r.source),
      total: r.total,
      reachedInterview: r.reachedInterview,
      hired: r.hired,
      hireRatePct: r.hireRatePct,
      // First-touch origin carries no spend of its own — spend is recorded per
      // CHANNEL. A zero here would read as "free"; null reads as "not measured".
      spendCzk: null,
      costPerHireCzk: null,
    })),
    ...data.byVariant.map((r) => ({
      // A creative is only identified WITHIN its campaign/role — two roles can
      // both run an "A" variant, and merging them would invent a comparison.
      key: `variant:${r.jobTitle ?? ""}:${r.campaign ?? ""}:${r.variant}`,
      kind: "variant" as const,
      name: [r.variant, r.jobTitle].filter(Boolean).join(" · "),
      total: r.total,
      reachedInterview: r.reachedInterview,
      hired: r.hired,
      // VariantStat carries no rate (the server leaves the ratio to the caller);
      // computed here on the same basis as the other two groups so the column
      // means one thing down its whole length.
      hireRatePct: r.total ? Math.round((r.hired / r.total) * 100) : 0,
      spendCzk: null,
      costPerHireCzk: null,
    })),
  ];

  const { sorted, sort, toggle } = useTableSort<Row, Col>(
    rows,
    {
      name: (r) => r.name,
      kind: (r) => r.kind,
      total: (r) => r.total,
      hired: (r) => r.hired,
      // A surface with nobody in it has no rate to rank; null keeps it out of the
      // ranking rather than posing as a 0% performer.
      hireRatePct: (r) => (r.total === 0 ? null : r.hireRatePct),
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
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[52rem] text-base">
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
                    <td className="py-2 pr-3 font-medium text-ink">{r.name}</td>
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
                      {r.total === 0 ? (
                        <span className="text-steel">—</span>
                      ) : (
                        <span className={r.hired > 0 ? "font-semibold text-moss" : "text-steel"}>{r.hireRatePct}%</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right nums">
                      {r.spendCzk != null ? <span className="text-ink">{money(r.spendCzk)}</span> : <span className="text-steel">—</span>}
                    </td>
                    <td className="py-2 text-right nums">
                      {r.costPerHireCzk != null ? (
                        <span className="font-semibold text-ink">{money(r.costPerHireCzk)}</span>
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

        {/* Says out loud that a dash in Spend is a measurement boundary, not a
            zero — the single most misreadable cell on this table. */}
        <p className="mt-3 border-t border-stone-200 pt-3 text-sm text-steel">{t("boardSpendNote")}</p>
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
          hired={data.hired}
          windowed={data.windowDays != null}
        />
      </Defer>
    </div>
  );
}
