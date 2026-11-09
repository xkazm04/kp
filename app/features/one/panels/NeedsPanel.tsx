"use client";

// needs — GET /api/attention: one row per bucket the sidebar badges count, each with its
// numeral, the view that answers it on /one, and its Console door. A bucket the read did
// not return is a dash with its reason, never 0.
import { useLocale, useTranslations } from "next-intl";
import { ABSENT, formatCount } from "@/app/_components/kit";
import type { AttentionCounts } from "@/app/_lib/attention";
import type { WorkspaceTabId } from "@/app/features/shell/tabs";
import { NEED_PANEL, type NeedKey } from "../engine/greeting";
import { biggest } from "./insight";
import { NameCell, PanelFrame } from "./PanelFrame";
import { ConsoleLink } from "./PanelShell";
import { isCount, useRead } from "./read";
import type { PanelProps } from "./types";

type Counts = Partial<Record<keyof AttentionCounts, number>>;

export function parseAttention(body: unknown): Counts | null {
  if (body == null || typeof body !== "object") return null;
  const out: Counts = {};
  for (const k of ["decisions", "pipeline", "channels", "schedule", "jobs", "companion"] as const) {
    const v = (body as Record<string, unknown>)[k];
    if (isCount(v)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

const TAB_OF: Record<NeedKey, WorkspaceTabId> = {
  decisions: "decisions",
  pipeline: "pipeline",
  channels: "channels",
  schedule: "schedule",
  jobs: "jobs",
};

const ROWS = ["decisions", "pipeline", "channels", "schedule", "jobs", "companion"] as const;

export function NeedsPanel(props: PanelProps) {
  const t = useTranslations("one.core.panels");
  const tg = useTranslations("one.core.greeting.first");
  const locale = useLocale();
  const read = useRead("/api/attention", parseAttention, props.epoch);
  const counts = read.state === "ready" ? read.data : null;
  const waiting = counts ? ROWS.filter((k) => (counts[k] ?? 0) > 0).length : null;
  const NEED_ORDER = ["decisions", "pipeline", "channels", "schedule", "jobs"] as const;
  const top = counts ? biggest(counts, NEED_ORDER) : null;
  const dash = (
    <span data-tip={t("notReturned")} tabIndex={0}>
      {ABSENT}
    </span>
  );
  return (
    <PanelFrame
      props={props}
      data={{
        title: t("needs.title"),
        count: waiting,
        insight: counts
          ? {
              shape: {
                label: t("insight.waiting"),
                parts: ROWS.flatMap((k) => {
                  const n = counts[k];
                  return isCount(n) && n > 0 ? [{ key: k, label: t(`needs.rows.${k}`), value: n }] : [];
                }).sort((a, b) => b.value - a.value),
              },
              facts: top
                ? [{ key: "biggest", label: t("insight.biggest"), value: t(`needs.rows.${top.key}`), sub: tg(top.key, { count: top.count }), mark: "needs" as const }]
                : [],
            }
          : undefined,
        read,
        cols: [
          { key: "name", label: t("cols.area"), track: "minmax(0,1fr)" },
          { key: "n", label: t("cols.waiting"), track: "5rem", end: true },
        ],
        actsTrack: "8rem",
        rows:
          counts && waiting !== 0
            ? ROWS.map((k) => {
                const raw = counts[k];
                const n = isCount(raw) ? raw : null;
                const spec = k === "companion" ? null : NEED_PANEL[k];
                const open = spec && n !== null && n > 0 ? () => props.onShow(spec.panel, spec.params) : undefined;
                const mark = n === null ? ("unknown" as const) : n > 0 ? ("needs" as const) : ("ok" as const);
                return {
                  key: k,
                  cells: {
                    name: <NameCell name={t(`needs.rows.${k}`)} sub={k === "companion" ? t("needs.companionWhere") : undefined} mark={mark} />,
                    n: n !== null ? formatCount(n, locale) : dash,
                  },
                  line: t(`needs.rows.${k}`),
                  meta: k === "companion" ? t("needs.companionWhere") : undefined,
                  trail: n !== null ? formatCount(n, locale) : dash,
                  mark,
                  tone: n !== null && n > 0 ? ("needs" as const) : undefined,
                  onSelect: open,
                  door: k === "companion" ? undefined : <ConsoleLink tab={TAB_OF[k]} />,
                };
              })
            : [],
        empty: t("needs.empty"),
      }}
    />
  );
}
