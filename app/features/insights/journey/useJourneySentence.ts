"use client";

// A row's sentence — the one place the board turns a `kind` + `facts` into
// words, and the part that differs most from the contest prototypes.
//
// The prototypes drew `event.text`, a pre-baked English sentence. There is no
// `text` field in the real payload and there must not be: a stored sentence
// ships English to a cs/de/fr reader, and a `kind` is countable across a cohort
// where prose is not (types.ts states both reasons). So the board asks
// `journeyEventMessageKey(event)` which catalog key a row renders through and
// lets next-intl resolve it, with the row's own `facts` as the ICU arguments.
//
// Two guards, both of which are honesty rather than defensiveness:
//
//  1. A key the catalogs do not hold falls back to `events.unknown`, which
//     renders the raw kind as an argument. A new source kind therefore degrades
//     to something true and visibly unstyled instead of to a blank row.
//  2. `JourneyFactValue` admits `boolean` and `null`, which ICU cannot
//     interpolate. They are coerced at this boundary — `null` to an em dash,
//     which is the app's absent-value glyph, not to "null".

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { journeyEventMessageKey } from "@/app/_lib/journey/render-keys";
import type { JourneyEvent, JourneyFactValue } from "@/app/_lib/journey/types";

type SentenceEvent = Pick<JourneyEvent, "kind" | "topicCode"> & {
  /** Omitted for a rail step — see stepPlaceholders below. */
  facts?: Record<string, JourneyFactValue>;
};

export function icuValues(facts: Record<string, JourneyFactValue>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(facts)) {
    if (value === null) out[key] = "—";
    else if (typeof value === "boolean") out[key] = String(value);
    else out[key] = value;
  }
  return out;
}

/**
 * A rail STEP has a kind and maybe a topic, but no facts — it is a step, not an
 * occurrence, so "Candidate advanced to {to}" has no `to` to advance to. Passing
 * `{}` would make next-intl report a missing argument and render the raw key
 * path into the rail, which is the ugliest possible way to be wrong.
 *
 * This stands an ellipsis in for every argument the message asks for. The rail
 * then reads "Candidate advanced to …", which is exactly what a canonical step
 * IS: the shape of the sentence, with the particulars left to the columns.
 */
export function stepPlaceholders(): Record<string, string> {
  return new Proxy(
    {},
    { get: (_target, key) => (typeof key === "string" ? "…" : undefined) }
  ) as Record<string, string>;
}

export function useJourneySentence(): (event: SentenceEvent) => string {
  const t = useTranslations("journey");
  type Key = Parameters<typeof t>[0];
  return useCallback(
    (event: SentenceEvent) => {
      // The key is decided at runtime from a ledger value, so the cast at this
      // boundary is the same one `useErrorMessage` makes for an error code —
      // guarded by the `has` check, never blind.
      const key = journeyEventMessageKey(event) as Key;
      // A step carries no facts at all (see stepPlaceholders); an event always
      // does, even when the message needs none of them.
      const values = event.facts === undefined ? stepPlaceholders() : icuValues(event.facts);
      if (t.has(key)) return t(key, values as never);
      return t("events.unknown", { kind: event.kind } as never);
    },
    [t]
  );
}
