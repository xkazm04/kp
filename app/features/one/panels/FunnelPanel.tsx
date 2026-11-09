"use client";

// funnel — GET /api/analytics?days=30: the windowed funnel the Analytics tab computes
// (reached per stage, conversion from the previous stage). The window is named on the
// state line; an entry stage's conversion is a dash with its reason (it has nothing
// before it), never 0 %.
import { useLocale, useTranslations } from "next-intl";
import { ABSENT, formatCount } from "@/app/_components/kit";
import { funnelInsight } from "./insight";
import { NameCell, PanelFrame } from "./PanelFrame";
import { isCount, useRead } from "./read";
import type { PanelProps } from "./types";

type Step = { stage: string; reached: number; conversionPct: number | null };
type FunnelRead = { total: number | null; steps: Step[] };

const FUNNEL_URL = "/api/analytics?days=30";

export function parseFunnel(body: unknown): FunnelRead | null {
  if (body == null || typeof body !== "object") return null;
  const b = body as { funnel?: unknown; total?: unknown };
  if (!Array.isArray(b.funnel)) return null;
  const steps: Step[] = [];
  for (const raw of b.funnel as unknown[]) {
    if (raw == null || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    if (typeof s.stage !== "string" || !isCount(s.reached)) continue;
    steps.push({ stage: s.stage, reached: s.reached, conversionPct: isCount(s.conversionPct) ? s.conversionPct : null });
  }
  return { total: isCount(b.total) ? b.total : null, steps };
}

export function FunnelPanel(props: PanelProps) {
  const t = useTranslations("one.core.panels");
  const locale = useLocale();
  const read = useRead(FUNNEL_URL, parseFunnel, props.epoch);
  const data = read.state === "ready" ? read.data : null;
  const empty = data !== null && (data.total === 0 || data.steps.every((s) => s.reached === 0));
  const pct = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const max = data ? Math.max(1, ...data.steps.map((s) => s.reached)) : 1;
  const conversion = (s: Step, i: number) =>
    s.conversionPct !== null ? (
      pct.format(s.conversionPct / 100)
    ) : (
      <span data-tip={i === 0 ? t("funnel.noConversion") : t("notReturned")} tabIndex={0}>
        {ABSENT}
      </span>
    );
  const reading = data && !empty ? funnelInsight(data.steps) : null;
  const last = data && !empty ? data.steps.at(-1) : undefined;
  return (
    <PanelFrame
      props={props}
      data={{
        title: t("funnel.title"),
        state: t("funnel.window"),
        insight:
          data && reading
            ? {
                spread: {
                  label: t("insight.reachedPerStep"),
                  bins: data.steps.map((s) => ({ key: s.stage, label: s.stage, value: s.reached })),
                },
                facts: [
                  ...(reading.drop
                    ? [{ key: "drop", label: t("insight.biggestDrop"), value: t("insight.dropValue", { from: reading.drop.from, to: reading.drop.to }), sub: t("insight.lost", { pct: pct.format(reading.drop.lostPct / 100) }), mark: "caution" as const }]
                    : []),
                  ...(reading.overallPct !== null && last
                    ? [{ key: "overall", label: t("insight.overall"), value: pct.format(reading.overallPct / 100), sub: t("insight.overallSub", { stage: last.stage }) }]
                    : []),
                ],
              }
            : undefined,
        console: { tab: "analytics" },
        read,
        cols: [
          { key: "name", label: t("cols.stage"), track: "minmax(0,1fr)" },
          { key: "reached", label: t("cols.reached"), track: "11rem", end: true },
          { key: "conv", label: t("cols.conversion"), track: "6rem", end: true },
        ],
        actsTrack: "0",
        rows:
          data && !empty
            ? data.steps.map((s, i) => ({
                key: s.stage,
                cells: {
                  name: <NameCell name={s.stage} />,
                  reached: (
                    <span className="flex items-center justify-end gap-2">
                      <span className="w-12 text-right">{formatCount(s.reached, locale)}</span>
                      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-stone-200" aria-hidden>
                        <span className="block h-full rounded-full bg-steel" style={{ width: `${Math.round((s.reached / max) * 100)}%` }} />
                      </span>
                    </span>
                  ),
                  conv: conversion(s, i),
                },
                line: s.stage,
                meta: s.conversionPct !== null ? pct.format(s.conversionPct / 100) : undefined,
                trail: formatCount(s.reached, locale),
              }))
            : [],
        empty: t("funnel.empty"),
      }}
    />
  );
}
