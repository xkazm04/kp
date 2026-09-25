"use client";

// The fact card — layer one — and the source excerpt behind it, as a second,
// explicit step.
//
// THE ORDER IS THE PRODUCT. A row click never opens a transcript. It opens what
// kp KNOWS about the row: who acted, both clocks, which phase, which topic, what
// changed. That is free — the board already holds it — and it is the layer a
// recruiter actually needs. Only then does `journey.detail.openSource` spend a
// request on the evidence underneath, and only then does a candidate's own words
// appear on screen. A board that renders transcripts inline turns a process
// overview into surveillance; this one makes reading someone's words a
// deliberate act.
//
// TWO CLOCKS, NEVER COLLAPSED. `occurredAt` and `recordedAt` are printed as two
// rows even when they agree, because a backfilled row and a live row are both
// legitimate and a report over a past window has to stay reproducible
// (types.ts, `audit-logging/two-clock-records`).

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit/Button";
import { DIVIDER, META_LABEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import type { JourneyEvent, JourneyEventDetail, JourneyOrigin } from "@/app/_lib/journey/types";
import { ACTOR_MARK_KEY, rowProvenance } from "./journeyMarks";
import { PHASE_LABEL_KEY } from "./JourneyRail";
import { useJourneySentence } from "./useJourneySentence";

export type JourneyFactCardProps = {
  event: JourneyEvent;
  /** The column the row hangs under. `null` for a SHARED job-definition row. */
  entryId: string | null;
  contextLabel: string;
  origin: JourneyOrigin | undefined;
  detail: JourneyEventDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  /** Null when there is no addressable source — see the note below. */
  onOpenSource: (() => void) | null;
  sourceOpened: boolean;
  onClose: () => void;
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="py-1.5 text-micro text-steel">{label}</dt>
      <dd className="py-1.5 text-micro text-ink">{children}</dd>
    </>
  );
}

export function JourneyFactCard({
  event,
  entryId,
  contextLabel,
  origin,
  detail,
  detailLoading,
  detailError,
  onOpenSource,
  sourceOpened,
  onClose,
}: JourneyFactCardProps) {
  const t = useTranslations("journey");
  const common = useTranslations("common");
  type Key = Parameters<typeof t>[0];
  const sentence = useJourneySentence();
  const { dateTime } = useDateFormat();
  const p = rowProvenance(event, origin);
  const topicKey = event.topicCode ? (`topics.${event.topicCode}` as Key) : null;

  return (
    <aside
      aria-label={t("title")}
      className="flex w-[26rem] max-w-full shrink-0 flex-col overflow-y-auto border-l-2 border-ink bg-white"
    >
      <div className="flex items-start justify-between gap-2 px-4 pt-4">
        <p className={META_LABEL}>{contextLabel}</p>
        <Button label={common("close")} icon="x" iconOnly variant="ghost" size="sm" onClick={onClose} />
      </div>

      <h2 className="px-4 pt-2 font-serif text-h2 leading-tight text-ink">{sentence(event)}</h2>

      <div className="flex flex-wrap gap-1.5 px-4 pt-3">
        <span className="rounded-full border border-stone-200 px-2 py-0.5 text-micro text-steel">
          {t(ACTOR_MARK_KEY[p.actor])}
        </span>
        {p.observed || p.fromTestRun ? (
          <span
            className={`rounded-full px-2 py-0.5 text-micro ${
              p.observed ? "border border-moss text-moss" : "border border-dashed border-dial-amber text-ink"
            }`}
          >
            {p.observed ? t("mark.observed") : t("mark.testRun")}
          </span>
        ) : null}
        {p.labelOnly ? (
          <span className="rounded-full border border-dashed border-dial-amber px-2 py-0.5 text-micro text-ink">
            {t("mark.labelOnly")}
          </span>
        ) : null}
      </div>

      <dl className={`mx-4 mt-4 grid grid-cols-[7rem_1fr] ${DIVIDER}`}>
        <Fact label={t("detail.actor")}>
          {event.actor === null ? (
            // A blank here would read as "we did not fill this in". The whole
            // point of the `| null` in the contract is that this is a fact.
            <span className="text-steel">{t("mark.unidentified")}</span>
          ) : (
            <code className="rounded-sm bg-stone-100 px-1 text-micro">{event.actor}</code>
          )}
        </Fact>
        <Fact label={t("detail.occurredAt")}>
          <time dateTime={event.occurredAt} className="nums">
            {dateTime(event.occurredAt)}
          </time>
        </Fact>
        <Fact label={t("detail.recordedAt")}>
          <time dateTime={event.recordedAt} className="nums">
            {dateTime(event.recordedAt)}
          </time>
        </Fact>
        <Fact label={t("detail.phase")}>{t(PHASE_LABEL_KEY[event.phase])}</Fact>
        {topicKey && t.has(topicKey) ? <Fact label={t("detail.topic")}>{t(topicKey)}</Fact> : null}
        {detail
          ? Object.entries(detail.card).map(([key, value]) => {
              const factKey = key as Key;
              return (
                <Fact key={key} label={t.has(factKey) ? t(factKey) : key}>
                  {value === null ? "—" : String(value)}
                </Fact>
              );
            })
          : null}
      </dl>

      <div className="mt-5 border-t-2 border-ink px-4 py-4">
        {onOpenSource === null ? (
          // A shared job-definition row belongs to the ROLE, not to any pipeline
          // entry, and the detail route is addressed by entry. Saying so is
          // better than offering a button that 404s.
          <p className="text-micro text-steel">{t("detail.noSource")}</p>
        ) : !sourceOpened ? (
          <Button label={t("detail.openSource")} variant="primary" size="sm" onClick={onOpenSource} />
        ) : detailLoading ? (
          <LoadingGap className="min-h-16" label={common("loading")} />
        ) : detailError ? (
          <p className="text-micro text-coral" role="alert">
            {detailError}
          </p>
        ) : detail?.source ? (
          <figure className={`${PANEL_SUNKEN} p-3`}>
            {t.has(detail.source.labelKey as Key) ? (
              <figcaption className={META_LABEL}>{t(detail.source.labelKey as Key)}</figcaption>
            ) : null}
            <blockquote className="mt-2 border-l-2 border-ink pl-3 font-serif text-body leading-relaxed text-ink">
              {detail.source.excerpt}
            </blockquote>
            {detail.source.reply ? (
              <blockquote className="mt-2 border-l-2 border-steel pl-3 font-serif text-body leading-relaxed text-steel">
                {detail.source.reply}
              </blockquote>
            ) : null}
          </figure>
        ) : (
          <p className="text-micro text-steel">{t("detail.noSource")}</p>
        )}
        {entryId === null ? null : (
          <p className="mt-3 text-micro text-steel">
            <code className="rounded-sm bg-stone-100 px-1">{`${event.sourceRef.table}:${event.sourceRef.id}`}</code>
          </p>
        )}
      </div>
    </aside>
  );
}
