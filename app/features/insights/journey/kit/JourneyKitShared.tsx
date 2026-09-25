"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ListRow, Mark, Section } from "@/app/_components/kit";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { normalizeAbsenceKey } from "../journeyLayout";
import { useJourneySentence } from "../useJourneySentence";
import { EventMark, provenanceOf } from "./JourneyKitEventMark";
import type { JourneyKit } from "./useJourneyKit";

/**
 * The role's job-definition band, drawn ONCE above every lane: the conversation that defined the
 * role belongs to the role, not to a candidate. It says whether the record links it to this role,
 * and when there is no conversation at all it says that, with the reason the columns carry, rather
 * than claiming one happened. "Show the conversation" unfolds its rows; each opens in the pane.
 */
export function JourneyKitShared({ k }: { k: JourneyKit }) {
  const t = useTranslations("journey");
  const tr = useTranslations("kit.graphic.rail");
  type Key = Parameters<typeof t>[0];
  const sentence = useJourneySentence();
  const { date } = useDateFormat();
  const [open, setOpen] = useState(false);
  const cluster = k.cluster;
  if (!cluster) return null;
  const events = cluster.sharedEvents;
  const unlinked = cluster.sharedEventsUnlinked;

  let state: string;
  if (events.length) {
    state = `${t("shared.headline", { count: cluster.totalColumns })}${unlinked ? ` ${t("shared.unlinked")}.` : ""}`;
  } else {
    const phase = cluster.columns[0]?.phases["job-definition"];
    const key = phase && !phase.present ? normalizeAbsenceKey(phase.absenceReasonKey) : "absence.intakeMissing";
    state = t.has(key as Key) ? t(key as Key) : t("absence.neverRecorded");
  }

  return (
    <Section
      id="journey-kit-shared"
      title={t("phases.job-definition")}
      count={tr("events", { count: events.length })}
      tone={events.length && unlinked ? "caution" : "default"}
      stateMark={events.length ? (unlinked ? <Mark kind="caution" /> : null) : <Mark kind="unknown" />}
      state={state}
      actions={
        events.length ? (
          <Button label={open ? t("kit.sharedFold") : t("kit.sharedShow")} size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} />
        ) : null
      }
    >
      {open
        ? events.map((e) => (
            <ListRow
              key={e.id}
              rowKey={e.id}
              mark={<EventMark event={e} origin={undefined} />}
              name={sentence(e)}
              provenance={provenanceOf(e, undefined)}
              time={date(e.occurredAt)}
              state={k.pane?.kind === "shared" && k.pane.eventId === e.id ? ["selected"] : []}
              onSelect={() => k.openShared(e.id)}
            />
          ))
        : null}
    </Section>
  );
}
