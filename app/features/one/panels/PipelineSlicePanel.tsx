"use client";

// pipelineSlice — GET /api/pipeline, the ACTIVE entries, optionally narrowed to a role
// (the user's own words, matched against the job title or id), to the stalled (the same
// aging tier the sidebar badge counts) or to new arrivals (the axis's entry stage).
// Params: role?, filter? ("aging" | "new").
import { useLocale, useTranslations } from "next-intl";
import { Mark } from "@/app/_components/kit";
import { ConsoleLink } from "./PanelShell";
import { CellTag, NameCell, PanelFrame, type Col, type InsightData, type PanelRow } from "./PanelFrame";
import { rowLimit, useDays } from "./cells";
import { entryInsight, entryParams, SCORE_BINS, suggestEntry } from "./insight";
import { parsePipeline, sliceEntries, type OneEntry } from "./pipelineRead";
import { useRead } from "./read";
import { ScoreBar, ScoreFig } from "./ScoreFig";
import type { PanelProps } from "./types";

export const ROW_LIMIT = 8;

/** The columns the two pipeline views share (decisionsQueue adds its acts). The age lives
 *  in the candidate's subline (it was a mostly-empty column); the name track has a floor,
 *  so a name never collapses to "F…". */
export function useEntryCols(): Col[] {
  const t = useTranslations("one.core.panels.cols");
  return [
    { key: "name", label: t("candidate"), track: "minmax(9rem,1.6fr)" },
    { key: "stage", label: t("stage"), track: "minmax(6rem,0.8fr)" },
    { key: "score", label: t("score"), track: "8.5rem", end: true },
  ];
}

export function useEntryRow(): (e: OneEntry, extra?: Pick<PanelRow, "acts" | "door" | "tone" | "keys">) => PanelRow {
  const t = useTranslations("one.core.panels");
  const days = useDays();
  return (e, extra) => {
    const age =
      e.ageDays !== null ? (
        <>
          {e.jobTitle ? <span aria-hidden>·</span> : null}
          {e.stale ? <Mark kind="caution" tip={t("stalled")} /> : null}
          <span className="k-nums">{days(e.ageDays)}</span>
        </>
      ) : null;
    return {
      key: e.id,
      cells: {
        name: <NameCell name={e.label} sub={e.jobTitle ?? undefined} trail={age} />,
        stage: <CellTag>{e.stageLabel}</CellTag>,
        score: <ScoreBar score={e.score} />,
      },
      line: e.label,
      meta: [e.stageLabel, e.jobTitle, e.ageDays !== null ? days(e.ageDays) : null].filter(Boolean).join(" · "),
      trail: <ScoreFig score={e.score} />,
      mark: e.stale ? "caution" : undefined,
      door: <ConsoleLink tab="pipeline" params={{ q: e.label }} />,
      ...extra,
    };
  };
}

/** The insight reading of a set of entries (panels/insight.ts does the arithmetic): where
 *  they stand, how the scores spread, who has waited longest, which role carries most — and,
 *  when `onPropose` is given, at most one suggested single-entry ADVANCE on a candidate in
 *  these rows (never a wave, never a reject), with its reason on one line. */
export function useEntryInsight(): (rows: readonly OneEntry[], onPropose: PanelProps["onPropose"] | null) => InsightData {
  const t = useTranslations("one.core.panels.insight");
  const locale = useLocale();
  const days = useDays();
  const pct = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  return (rows, onPropose) => {
    const i = entryInsight(rows);
    const pick = onPropose ? suggestEntry(rows) : null;
    const facts: NonNullable<InsightData["facts"]> = [];
    if (i.oldest) {
      facts.push({
        key: "oldest",
        label: t("oldest"),
        value: i.oldest.label,
        sub: t("inStage", { stage: i.oldest.stageLabel, days: days(i.oldest.days) }),
        mark: i.oldest.stale ? "caution" : undefined,
      });
    }
    if (i.topRole) facts.push({ key: "role", label: t("topRole"), value: i.topRole.title, sub: t("candidates", { count: i.topRole.count }) });
    const reason = (() => {
      if (!pick) return "";
      const e = pick.entry;
      if (pick.reason === "stalled") return t("reasonStalled", { days: days(e.ageDays), stage: e.stageLabel });
      const score = pct.format((e.score ?? 0) / 100);
      return e.ageDays !== null ? t("reasonScoreDays", { score, days: days(e.ageDays) }) : t("reasonScore", { score });
    })();
    return {
      shape: {
        label: t("stages"),
        parts: [...i.stages.map((s) => ({ key: s.stage, label: s.label, value: s.count })), ...(i.other > 0 ? [{ key: "other", label: t("other"), value: i.other }] : [])],
      },
      spread: {
        label: t("scores"),
        note: i.unscored > 0 ? t("unscored", { count: i.unscored }) : undefined,
        bins: SCORE_BINS.map((b) => ({ key: b.key, label: t(`bins.${b.key}`), value: i.bins[b.key], tone: b.tone })),
      },
      facts,
      suggest:
        pick && onPropose
          ? {
              label: t("suggestAdvance", { label: pick.entry.label }),
              hint: reason,
              onPress: () => onPropose("entryAdvance", entryParams(pick.entry)),
            }
          : undefined,
    };
  };
}

export function PipelineSlicePanel(props: PanelProps) {
  const t = useTranslations("one.core.panels");
  const { params } = props.panel;
  const read = useRead("/api/pipeline", parsePipeline, props.epoch);
  const cols = useEntryCols();
  const entryRow = useEntryRow();
  const insightOf = useEntryInsight();
  const all = read.state === "ready" ? read.data.entries : [];
  const rows = read.state === "ready" ? sliceEntries(all, params) : [];
  const limit = rowLimit(props.look);
  const title =
    params.filter === "aging" ? t("pipelineSlice.titleAging") : params.filter === "new" ? t("pipelineSlice.titleNew") : t("pipelineSlice.title");
  const empty = params.role
    ? t("pipelineSlice.emptyRole", { role: params.role })
    : params.filter === "aging"
      ? t("pipelineSlice.emptyAging")
      : params.filter === "new"
        ? t("pipelineSlice.emptyNew")
        : t("pipelineSlice.empty");
  return (
    <PanelFrame
      props={props}
      data={{
        title,
        count: rows.length,
        state: params.role ? t("pipelineSlice.forRole", { role: params.role }) : undefined,
        console: { tab: "pipeline", params: params.role ? { role: params.role } : {} },
        read,
        cols,
        actsTrack: "8rem",
        rows: rows.slice(0, limit).map((e) => entryRow(e)),
        insight: props.look === "insight" ? insightOf(rows, props.onPropose) : undefined,
        empty,
        foot: rows.length > limit ? t("firstOf", { shown: limit, total: rows.length }) : undefined,
      }}
    />
  );
}
