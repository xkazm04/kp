"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, KeyValueGrid, Tag, type KeyValue } from "@/app/_components/kit";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import type { JourneyEvent, JourneyOrigin, JourneyPhaseId } from "@/app/_lib/journey/types";
import { useJourneyDetail } from "../useJourneyDetail";
import { useJourneySentence } from "../useJourneySentence";
import { EventMark, provenanceWords, textClass } from "./JourneyKitEventMark";

/** Phase names as literal catalog keys (JourneyRail's PHASE_LABEL_KEY, restated so the kit chunk
 *  does not pull the Broadsheet's rail component in with it). */
export const PHASE_KEY: Record<JourneyPhaseId, "phases.job-definition" | "phases.case" | "phases.screening"> = {
  "job-definition": "phases.job-definition",
  case: "phases.case",
  screening: "phases.screening",
};

/**
 * One row's record, the Broadsheet's fact card on kit parts: the sentence, who did it and what kind
 * of row it is, BOTH clocks (never collapsed), the phase and topic; then "Open the source", the
 * second detail layer (useJourneyDetail, GET /api/journeys/[entryId]?event=), which a shared row
 * cannot have: it belongs to the role, and the route is addressed by entry.
 */
export function JourneyKitFact({ event, entryId, origin }: { event: JourneyEvent; entryId: string | null; origin: JourneyOrigin | undefined }) {
  const t = useTranslations("journey");
  type Key = Parameters<typeof t>[0];
  const sentence = useJourneySentence();
  const { dateTime } = useDateFormat();
  const detail = useJourneyDetail();
  const [asked, setAsked] = useState(false);
  const { reset } = detail;
  // A different row is a different record: the opened source must not follow it.
  useEffect(() => () => reset(), [event.id, reset]);

  const topic = event.topicCode ? (`topics.${event.topicCode}` as Key) : null;
  const items: KeyValue[] = [
    { label: t("detail.actor"), value: event.actor ?? null, absent: t("mark.unidentified") },
    { label: t("detail.occurredAt"), value: dateTime(event.occurredAt) },
    { label: t("detail.recordedAt"), value: dateTime(event.recordedAt) },
    { label: t("detail.phase"), value: t(PHASE_KEY[event.phase]) },
    ...(topic && t.has(topic) ? [{ label: t("detail.topic"), value: t(topic) }] : []),
    ...Object.entries(detail.detail?.card ?? {}).map(([key, value]) => ({
      label: t.has(key as Key) ? t(key as Key) : key,
      value: value === null ? null : String(value),
    })),
  ];
  const source = detail.detail?.source;

  return (
    <div className="jk-fact" data-role="journey-kit-fact">
      <div className="k-verdict">
        <EventMark event={event} origin={origin} />
        <div>
          <b className={textClass(event, origin)}>{sentence(event)}</b>
          <br />
          <span className="k-absent">{provenanceWords(event, origin, t)}</span>
        </div>
      </div>
      <KeyValueGrid items={items} cols={2} />
      <div className="jk-fact__source">
        {entryId === null ? (
          <p className="k-absent">{t("detail.noSource")}</p>
        ) : !asked ? (
          <Button label={t("detail.openSource")} variant="secondary" size="sm" onClick={() => { setAsked(true); detail.load(entryId, event.id); }} />
        ) : detail.loading ? (
          <LoadingGap className="min-h-16" />
        ) : detail.error ? (
          <p className="jk-error" role="alert">{detail.error}</p>
        ) : source ? (
          <figure className="jk-source">
            {t.has(source.labelKey as Key) ? <figcaption className="k-section__count">{t(source.labelKey as Key)}</figcaption> : null}
            <blockquote className="k-excerpt">{source.excerpt}</blockquote>
            {source.reply ? <blockquote className="k-excerpt">{source.reply}</blockquote> : null}
          </figure>
        ) : (
          <p className="k-absent">{t("detail.noSource")}</p>
        )}
        {entryId === null ? null : <Tag label={`${event.sourceRef.table}:${event.sourceRef.id}`} />}
      </div>
    </div>
  );
}
