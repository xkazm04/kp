"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ListRow, Mark, Section, type MarkKind } from "@/app/_components/kit";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import { useShellNavigate } from "@/app/features/shell/nav/shallow-nav";
import { boardPopulation, deriveRailRows } from "../pipelineBoardPopulation";
import { overviewQueues, type OverviewQueue, type QueueKey } from "../orbit/overview/overviewModel";
import type { PipelineTabState } from "../usePipelineTabState";

const NAMES = 2;
const MARK: Record<QueueKey, MarkKind> = { decisions: "needs", inbound: "wait", scorecards: "needs", offerReviews: "needs", awaitingSlot: "wait", offersOut: "wait", hired: "ok" };
const CTA = { showBoard: "showBoard", openDecisions: "openDecisions", openSchedule: "openSchedule" } as const;

/**
 * "Today" (the retired Today rail, 8f8f578d): the day's candidate-driven work, narrated. The waiting
 * figure and chip say HOW MANY need you; this says WHO and WHERE, one row per non-empty queue: the
 * SAME queues the Overview draws (`overviewQueues`: the people waiting on a decision, new
 * applications, scorecards and drafted offers to review, interviews waiting on a slot, offers out,
 * this week's hires). Each row is the door where its queue is worked (a stage on this page, which the
 * Orbit answers by focusing that ring; Decisions; or Schedule). Who is in each queue is deriveRailRows
 * (real rows, live status, stage questions by ROLE) plus the decisions queue, the population the head
 * counts. Hidden when all is quiet.
 */
export function PipelineKitToday({ s, onShowStage }: { s: PipelineTabState; onShowStage: (stage: string) => void }) {
  const t = useTranslations("pipeline.today");
  const tl = useTranslations("overviewLit.queue");
  const nav = useShellNavigate();
  const search = useSearchParams();
  const [now] = useState(() => Date.now());
  const queues = overviewQueues(deriveRailRows(s.entries, s.axis, now), boardPopulation(s.entries).active, s.axis);
  if (!queues.length) return null;

  const go = (q: OverviewQueue) => {
    if (q.stage) onShowStage(q.stage);
    else if (q.tab) nav.push(buildUrl({ tab: q.tab, ...clearedTabScopedParams() }, search.toString()));
  };
  const cta = (q: OverviewQueue) => (q.stage ? CTA.showBoard : q.tab === "schedule" ? CTA.openSchedule : CTA.openDecisions);
  const names = (q: OverviewQueue) => {
    const shown = q.entries.slice(0, NAMES).map((e) => e.candidateLabel).join(", ");
    return q.entries.length > NAMES ? `${shown} +${q.entries.length - NAMES}` : shown;
  };
  const name = (q: OverviewQueue) => (q.key === "decisions" ? tl("decisions", { count: q.entries.length }) : t(q.key, { count: q.entries.length }));

  return (
    <Section title={t("eyebrow")} count={queues.length}>
      {queues.map((q) => (
        <ListRow
          key={q.key}
          mark={<Mark kind={MARK[q.key]} />}
          name={name(q)}
          meta={names(q)}
          actions={<Button label={t(cta(q))} icon="right" variant="link" size="sm" onClick={() => go(q)} />}
          state={q.needs ? ["needs"] : []}
          onSelect={() => go(q)}
          rowKey={q.key}
        />
      ))}
    </Section>
  );
}
