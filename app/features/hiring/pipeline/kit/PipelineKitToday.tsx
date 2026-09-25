"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ListRow, Mark, Section, type MarkKind } from "@/app/_components/kit";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import { useShellNavigate } from "@/app/features/shell/nav/shallow-nav";
import { deriveRailRows, type RailBucket, type RailBucketKey } from "../pipelineBoardPopulation";
import type { PipelineTabState } from "../usePipelineTabState";
import type { PipelineKit } from "./usePipelineKit";

const NAMES = 2;
const MARK: Record<RailBucketKey, MarkKind> = { inbound: "wait", scorecards: "needs", offerReviews: "needs", awaitingSlot: "wait", offersOut: "wait", hired: "ok" };
const CTA = { showBoard: "showBoard", openDecisions: "openDecisions", openSchedule: "openSchedule" } as const;

/**
 * "Today" (the retired Today rail, 8f8f578d): the day's candidate-driven work, narrated. The waiting
 * figure and chip say HOW MANY need you; this says WHO and WHERE, one row per non-empty queue (new
 * applications, scorecards and drafted offers to review, interviews waiting on a slot, offers out,
 * this week's hires). Each row is the door where its queue is worked (its layer on this page,
 * Decisions, or Schedule; the act track names it). Who is in each queue is deriveRailRows (real rows,
 * live status, stage questions by ROLE), the population the head counts. Hidden when all is quiet.
 */
export function PipelineKitToday({ s, k }: { s: PipelineTabState; k: PipelineKit }) {
  const t = useTranslations("pipeline.today");
  const nav = useShellNavigate();
  const search = useSearchParams();
  const [now] = useState(() => Date.now());
  const rows = deriveRailRows(s.entries, s.axis, now);
  if (!rows.length) return null;

  const go = (row: RailBucket) => {
    if (row.stage) k.showLayer(row.stage);
    else if (row.tab) nav.push(buildUrl({ tab: row.tab, ...clearedTabScopedParams() }, search.toString()));
  };
  const cta = (row: RailBucket) => (row.stage ? CTA.showBoard : row.tab === "schedule" ? CTA.openSchedule : CTA.openDecisions);
  const names = (row: RailBucket) => {
    const shown = row.entries.slice(0, NAMES).map((e) => e.candidateLabel).join(", ");
    return row.entries.length > NAMES ? `${shown} +${row.entries.length - NAMES}` : shown;
  };

  return (
    <Section title={t("eyebrow")} count={rows.length}>
      {rows.map((row) => (
        <ListRow
          key={row.key}
          mark={<Mark kind={MARK[row.key]} />}
          name={t(row.key, { count: row.entries.length })}
          meta={names(row)}
          actions={<Button label={t(cta(row))} icon="right" variant="link" size="sm" onClick={() => go(row)} />}
          state={MARK[row.key] === "needs" ? ["needs"] : []}
          onSelect={() => go(row)}
          rowKey={row.key}
        />
      ))}
    </Section>
  );
}
