"use client";

import { useLocale, useTranslations } from "next-intl";
import { KeyValueGrid, Mark, ReadingPane, Section, formatCount } from "@/app/_components/kit";
import { StageRail, type ColumnStep } from "@/app/_components/kit/graphic";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { useJourneySentence } from "../useJourneySentence";
import { JourneyKitFact } from "./JourneyKitFact";
import { JourneyKitTrail } from "./JourneyKitTrail";
import { underWay } from "./journeyKitModel";
import { paneSteps, trailRows } from "./journeyKitPaneModel";
import type { JourneyKit } from "./useJourneyKit";
import { SHAPE_WORD, useLaneWords } from "./useLaneWords";

/**
 * The reading pane: one candidate's journey document (who and where, what waits on you, the record,
 * the role's own kind rail against this journey as a column StageRail, and the trail with its gaps),
 * or one row of the role's shared band. It exists only while something is open.
 */
export function JourneyKitPane({ k }: { k: JourneyKit }) {
  const t = useTranslations("journey");
  const locale = useLocale();
  const { date } = useDateFormat();
  const sentence = useJourneySentence();
  const { statusMark } = useLaneWords();
  const cluster = k.cluster;
  if (!k.pane || !cluster) return null;

  if (k.pane.kind === "shared") {
    const eventId = k.pane.eventId;
    const event = cluster.sharedEvents.find((e) => e.id === eventId);
    if (!event) return null;
    return (
      <ReadingPane trail={[t("title"), cluster.title, t("phases.job-definition")]} index={-1} total={0} onStep={() => {}} onClose={k.close} itemKey={event.id}>
        <JourneyKitFact key={event.id} event={event} entryId={null} origin={undefined} />
      </ReadingPane>
    );
  }

  const lane = k.openLane;
  if (!lane) return null;
  const col = lane.column;
  const steps = paneSteps(cluster.rail, col);
  const column: ColumnStep[] = steps.map((s) => {
    const label = sentence({ kind: s.rail.kind, topicCode: s.rail.topicCode });
    const word = SHAPE_WORD[s.shape];
    return {
      id: String(s.rail.index),
      label,
      shape: s.shape,
      tip: s.state === "present" ? `${label}${word ? `. ${t(word)}` : ""}` : `${label}: ${t(s.state === "skipped" ? "rail.skipped" : "rail.neverReached")}`,
      count: s.events.length,
      reason: s.state === "present" ? undefined : t(s.state === "skipped" ? "rail.skipped" : "rail.neverReached"),
      time: s.events[0] ? date(s.events[0].occurredAt) : undefined,
    };
  });
  const reached = steps.filter((s) => s.state === "present").length;
  const rows = trailRows(col, {
    hasKey: k.hasKey,
    underWay: underWay(lane.status),
    now: k.now,
    keep: k.observedOnly ? (e) => e.confidence !== "label-only" && col.origin.kind !== "test-run" : undefined,
  });

  return (
    <ReadingPane trail={[t("title"), cluster.title, col.candidateLabel]} index={k.index} total={k.rows.length} onStep={k.step} onClose={k.close} itemKey={col.entryId}>
      <h3 className={col.origin.kind === "test-run" ? "k-gen" : undefined}>{col.candidateLabel}</h3>
      <p className="k-margin__sub">{[col.stage, cluster.title].join(" · ")}</p>
      {lane.status === "needs" ? (
        <div className="k-verdict"><Mark kind="needs" /><div><b>{t("kit.figHeld")}</b> · {t("kit.markNeeds")}</div></div>
      ) : null}
      <KeyValueGrid
        items={[
          { label: t("kit.kvStage"), value: col.stage },
          { label: t("kit.colMatch"), value: col.matchScore == null ? null : formatCount(col.matchScore, locale), absent: t("kit.neverScored") },
          { label: t("kit.kvStatus"), value: <span className="jk-status">{statusMark(lane)}</span> },
          { label: t("kit.kvLanguage"), value: col.locale },
          { label: t("kit.kvOrigin"), value: col.origin.kind === "live" ? t("kit.originLive") : `${t("mark.testRun")} · ${col.origin.runId}` },
          { label: t("kit.kvEvents"), value: formatCount(col.events.length, locale) },
        ]}
      />
      <Section title={t("kit.paneThrough")} count={t("kit.paneThroughCount", { reached, total: steps.length })}>
        <StageRail orientation="column" steps={column} label={t("rail.forRole", { role: cluster.title })} />
      </Section>
      <Section title={t("kit.paneTrail")} count={formatCount(col.events.length, locale)}>
        <JourneyKitTrail key={col.entryId} rows={rows} entryId={col.entryId} origin={col.origin} />
      </Section>
    </ReadingPane>
  );
}
