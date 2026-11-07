"use client";

// needs — GET /api/attention: one row per bucket the sidebar badges count, each with its
// numeral, the view that answers it on /one, and its Console door. A bucket the read did
// not return is a dash with its reason, never 0.
import { useLocale, useTranslations } from "next-intl";
import { ListRow, Mark, ABSENT, formatCount } from "@/app/_components/kit";
import type { AttentionCounts } from "@/app/_lib/attention";
import type { WorkspaceTabId } from "@/app/features/shell/tabs";
import { NEED_PANEL, type NeedKey } from "../engine/greeting";
import { ConsoleLink, EmptyLine, PanelShell } from "./PanelShell";
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
  const locale = useLocale();
  const read = useRead("/api/attention", parseAttention, props.epoch);
  const counts = read.state === "ready" ? read.data : null;
  const waiting = counts ? ROWS.filter((k) => (counts[k] ?? 0) > 0).length : null;
  return (
    <PanelShell props={props} title={t("needs.title")} count={waiting ?? undefined} read={read}>
      {counts && waiting === 0 ? <EmptyLine>{t("needs.empty")}</EmptyLine> : null}
      {counts && waiting !== 0
        ? ROWS.map((k) => {
            const raw = counts[k];
            const n = isCount(raw) ? raw : null;
            const spec = k === "companion" ? null : NEED_PANEL[k];
            return (
              <ListRow
                key={k}
                rowKey={k}
                mark={<Mark kind={n === null ? "unknown" : n > 0 ? "needs" : "ok"} />}
                name={t(`needs.rows.${k}`)}
                sub={k === "companion" ? t("needs.companionWhere") : undefined}
                fig={
                  n !== null ? (
                    formatCount(n, locale)
                  ) : (
                    <span data-tip={t("notReturned")} tabIndex={0}>
                      {ABSENT}
                    </span>
                  )
                }
                state={n !== null && n > 0 ? ["needs"] : ["muted"]}
                onSelect={spec && n !== null && n > 0 ? () => props.onShow(spec.panel, spec.params) : undefined}
                actions={k === "companion" ? undefined : <ConsoleLink tab={TAB_OF[k]} />}
              />
            );
          })
        : null}
    </PanelShell>
  );
}
