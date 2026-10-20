"use client";

import { useTranslations } from "next-intl";
import { QueueCard } from "@/app/_components/kit/scene";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import type { OrbitWords } from "../orbitWords";
import type { LitVia } from "./overviewModel";
import type { QueueView } from "./overviewParts";

/** Names shown on a card before "+N more": the card's press opens the orbit, whose lit strip lists every one (OrbitLitStrip, "Show all N"). */
const NAMES = 2;

type Props = {
  q: QueueView;
  words: OrbitWords;
  hot: boolean;
  onHot: (on: boolean, via: LitVia) => void;
  /** The card's main press: open the orbit with this queue's people lit. */
  onOpen: () => void;
  /** Where the queue is worked: its ring on the board, or Decisions / Schedule. */
  onDoor: () => void;
  onPerson: (e: Entry, cohort: readonly Entry[]) => void;
  cardRef: (el: HTMLElement | null) => void;
};

/**
 * One of Today's queues as the kit's `QueueCard`: its count and what it is (the press that lights its
 * people and opens the orbit), the most urgent names (each opens the person's record), the stages
 * they stand on, and the door where the queue is worked. Pointing at the card, or focusing anything
 * inside it, lights exactly its people on the orbit.
 */
export function OverviewQueue({ q, words, hot, onHot, onOpen, onDoor, onPerson, cardRef }: Props) {
  const tl = useTranslations("overviewLit.queue");
  const shown = q.people.slice(0, NAMES);
  const more = q.people.length - shown.length;
  return (
    <QueueCard
      data-role="overview-today"
      data-key={q.key}
      count={words.n(q.entries.length)}
      noun={q.noun}
      openLabel={tl("openAria", { label: q.label })}
      onOpen={onOpen}
      names={shown.map((e) => ({ key: e.id, label: e.candidateLabel, onSelect: () => onPerson(e, q.people) }))}
      more={more > 0 ? tl("more", { count: more }) : null}
      on={q.stages ? tl("on", { stages: q.stages }) : null}
      door={{ label: q.door, onSelect: onDoor }}
      needs={q.needs}
      hot={hot}
      onHot={onHot}
      cardRef={cardRef}
    />
  );
}
