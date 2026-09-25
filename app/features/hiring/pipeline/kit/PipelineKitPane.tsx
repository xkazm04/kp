"use client";

import { useLocale, useTranslations } from "next-intl";
import { Button, KeyValueGrid, Mark, Note, ReadingPane, Section, formatCount } from "@/app/_components/kit";
import { StageRail } from "@/app/_components/kit/graphic";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { canonicalScoreOf } from "@/app/_lib/match-score";
import { stageHasRole } from "@/app/_lib/pipeline-stages";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { useCandidateBundle } from "../candidate/state/useCandidateBundle";
import { useEventVerb } from "../PipelineShared";
import type { PipelineTabState } from "../usePipelineTabState";
import type { PipelineKit } from "./usePipelineKit";
import { provenance } from "./pipelineKitModel";
import { historyTrail, pathCells, stagePosition } from "./pipelinePaneModel";
import { useApprovalWord } from "./useApprovalWord";
import { PipelineKitMove } from "./PipelineKitMove";

/**
 * The reading pane for one entry: who and where, what waits on you, the record, the entry's path
 * through the stages (a column StageRail) and its history with the silences in place. The path and
 * the history come from the entry's own events (GET /api/pipeline/[id]/timeline, the candidate
 * modal's one request); everything above them is the board row.
 */
export function PipelineKitPane({ s, k, entry, onOpenRecord }: { s: PipelineTabState; k: PipelineKit; entry: Entry; onOpenRecord: () => void }) {
  const t = useTranslations("pipeline.kit");
  const tt = useTranslations("pipeline.tab");
  const locale = useLocale();
  const fmt = useDateFormat();
  const enumLabel = useEnumLabel();
  const eventVerb = useEventVerb();
  const approval = useApprovalWord();
  const bundle = useCandidateBundle(entry);
  const events = bundle.mergedHistory.flatMap((r) => (r.type === "event" ? [r.ev] : []));
  const stageLabel = k.layers.find((l) => l.id === entry.stage)?.label ?? entry.stage;
  const live = entry.status === "active" && !stageHasRole(entry.stage, "terminal", s.axis);
  const pv = provenance(entry);
  const score = canonicalScoreOf(entry);
  const waiting = k.ctx.needs(entry);
  const loading = bundle.bundleStatus === "loading";
  const failed = bundle.bundleFailed;
  const cells = pathCells(s.axis, entry.stage, events).map((c) => ({
    id: c.id,
    label: c.label,
    shape: loading ? ("none" as const) : c.shape,
    tip: c.reason === "reached" ? t("cellReached", { stage: c.label, count: c.count }) : `${c.label}: ${t(`cell.${c.reason}`)}`,
    count: c.count,
    reason: c.reason === "reached" ? undefined : t(`cell.${c.reason}`),
    time: c.first ? fmt.date(c.first) : undefined,
  }));
  const trail = historyTrail(events, { live, now: k.ctx.now });

  return (
    <ReadingPane trail={[s.t("eyebrow"), stageLabel, entry.candidateLabel]} index={k.index} total={k.rows.length} onStep={k.step} onClose={() => k.select(null)} itemKey={entry.id}>
      <h3>{entry.candidateLabel}</h3>
      <p className="k-margin__sub">{[entry.jobTitle, stageLabel].filter(Boolean).join(" · ")}</p>
      {waiting ? (
        <>
          <div className="k-verdict"><Mark kind="needs" /><div><b>{t("chipWaiting")}</b> · {approval(entry.approvalKind)}</div></div>
          <Button label={t("openDecisions")} variant="primary" onClick={s.goToDecisions} />
        </>
      ) : null}
      {s.moveError && s.moveErrorEntryId === entry.id ? (
        <Note tone="critical" action={<Button label={tt("moveErrorDismiss")} variant="ghost" size="sm" onClick={s.dismissMoveError} />}>{s.moveError}</Note>
      ) : null}
      {/* The kit's move: a menu here (and on the row), `m` while this pane is open. Rejected rows move in the record. */}
      {entry.status === "active" ? <div className="k-pane-acts"><PipelineKitMove s={s} entry={entry} where="pane" hotkey /></div> : null}
      <KeyValueGrid
        items={[
          { label: t("kvStage"), value: stageLabel },
          { label: t("colMatch"), value: score == null ? null : formatCount(score, locale), absent: t("neverScoredTip") },
          { label: t("kvHow"), value: t(`prov.${pv}`) },
          { label: t("kvArchetype"), value: entry.archetype ? enumLabel("archetype", entry.archetype) : null, absent: t("archetypeNone") },
          { label: t("colSource"), value: entry.sourceChannel ? s.channelName(entry.sourceChannel) : null, absent: t("sourceNone") },
          { label: t("kvAdded"), value: entry.createdAt ? fmt.date(entry.createdAt) : null },
          { label: t("kvChanged"), value: pv === "solid" && entry.stageChangedAt ? fmt.date(entry.stageChangedAt) : null, absent: t("neverMovedTip") },
          { label: t("kvIntake"), value: entry.intakeDegraded ? t("intakeDegraded") : t("intakeFull") },
        ]}
      />
      <Section
        title={t("throughTitle")}
        count={t("throughCount", { at: stagePosition(s.axis, entry.stage), total: s.axis.length })}
        status={loading ? "loading" : failed ? "error" : "ready"}
        errorText={t("historyFailed")}
        onRetry={bundle.retry}
      >
        <StageRail orientation="column" steps={cells} label={t("throughTitle")} />
      </Section>
      <Section
        title={t("historyTitle")}
        count={loading ? undefined : t("historyCount", { count: events.length })}
        status={loading ? "loading" : failed ? "error" : "ready"}
        errorText={t("historyFailed")}
        onRetry={bundle.retry}
        actions={<Button label={t("openRecord")} variant="ghost" size="sm" onClick={onOpenRecord} />}
      >
        {trail.map((r) =>
          r.kind === "event" ? (
            <div key={r.key} className="k-mini k-measure">
              <div className="k-row__mark"><Mark kind="nobody" tip={t("actorUnknown")} /></div>
              <div className="k-row__name">{eventVerb(r.event)}</div>
              <div className="k-row__time">{fmt.date(r.event.createdAt)}</div>
            </div>
          ) : (
            <div key={r.key} className="k-mini k-measure k-gap">
              <div className="k-row__mark">{r.kind === "nothing" ? <Mark kind="unknown" /> : null}</div>
              <div className="k-row__name">
                {r.kind === "nothing" ? t("historyNothing") : r.untilToday ? t("silenceToday", { days: r.days }) : t("silence", { days: r.days })}
              </div>
            </div>
          )
        )}
      </Section>
    </ReadingPane>
  );
}
