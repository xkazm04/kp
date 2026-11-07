"use client";

// funnel — GET /api/analytics?days=30: the windowed funnel the Analytics tab computes
// (reached per stage, conversion from the previous stage). The window is named on the
// state line; an entry stage's conversion is a dash with its reason (it has nothing
// before it), never 0 %.
import { useLocale, useTranslations } from "next-intl";
import { ListRow, ABSENT, formatCount } from "@/app/_components/kit";
import { EmptyLine, PanelShell } from "./PanelShell";
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
  return (
    <PanelShell props={props} title={t("funnel.title")} state={t("funnel.window")} read={read} console={{ tab: "analytics" }}>
      {empty ? <EmptyLine>{t("funnel.empty")}</EmptyLine> : null}
      {data && !empty
        ? data.steps.map((s, i) => (
            <ListRow
              key={s.stage}
              rowKey={s.stage}
              name={s.stage}
              meta={t("funnel.reached")}
              fig={<span className="k-nums">{formatCount(s.reached, locale)}</span>}
              time={
                s.conversionPct !== null ? (
                  <span className="k-nums">{pct.format(s.conversionPct / 100)}</span>
                ) : (
                  <span data-tip={i === 0 ? t("funnel.noConversion") : t("notReturned")} tabIndex={0}>
                    {ABSENT}
                  </span>
                )
              }
            />
          ))
        : null}
    </PanelShell>
  );
}
