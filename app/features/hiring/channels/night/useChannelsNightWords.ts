"use client";

import { useTranslations } from "next-intl";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { BACKLOG_KEY, CHIP_KEY, NODE_NAME } from "./channelsNightCopy";
import type { NightNode, Plate } from "./channelsNightPlumbing";

/**
 * A plate's words: the building's name, its chip, its one fact, in the reader's language. The
 * model returns keys and numbers (channelsNightPlumbing.ts), this turns them into sentences,
 * with times relative to now and the edge's backlog in the edge card's own words.
 */
export function usePlateWords() {
  const t = useTranslations();
  const tf = useTranslations("channelsNight.plumbing.fact");
  const rel = useRelativeTime();
  return {
    name: (node: NightNode) => t(NODE_NAME[node]),
    words: (plate: Plate) => {
      const backlog = plate.backlog ? t(BACKLOG_KEY[plate.backlog], { pending: plate.n.pending ?? 0 }) : "";
      const fact = plate.fact ? tf(plate.fact, { ...plate.n, time: rel(plate.when), backlog }) : null;
      return {
        title: t(NODE_NAME[plate.node]),
        chip: t(CHIP_KEY[plate.chip], { count: plate.n.needs ?? 0 }),
        fact: fact && plate.partial ? `${fact} · ${tf("olderExist")}` : fact,
      };
    },
  };
}
