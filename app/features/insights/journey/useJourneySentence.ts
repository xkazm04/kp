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

/** The only message whose argument is the kind rather than a fact. */
const UNKNOWN_KEY = "events.unknown";

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

/** The simple ICU arguments a message declares. The journey namespace uses plain
 *  `{name}` interpolation, no plural/select arms, so this is enough — and it is
 *  what lets the values object be built with REAL own properties. */
export function messagePlaceholders(message: string): string[] {
  return [...message.matchAll(/\{\s*([A-Za-z0-9_]+)\s*[,}]/g)].map((m) => m[1]);
}

/**
 * A rail STEP has a kind and maybe a topic, but no facts — it is a step, not an
 * occurrence, so "Candidate advanced to {to}" has no `to` to advance to. This
 * stands an ellipsis in for every argument the message asks for, so the rail
 * reads "Candidate advanced to …", which is exactly what a canonical step IS:
 * the shape of the sentence with the particulars left to the columns.
 *
 * Built from the message's OWN declared arguments rather than returned as a
 * Proxy. The Proxy answered any property read, but it had no own keys, so
 * anything that enumerated or spread it saw an empty object and the argument
 * went missing at format time — the same failure mode, by a different route,
 * as the one `journeySentenceArgs` fixes.
 */
export function stepPlaceholders(message: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of messagePlaceholders(message)) out[name] = "…";
  return out;
}

/**
 * The key a row renders through, and the arguments that key needs. Pure, so the
 * pairing can be tested without a React renderer — which is what this module
 * owed: it shipped resolving `events.unknown` through the ordinary branch, whose
 * arguments are the row's FACTS and therefore never carry `kind`, because the
 * kind is not a fact ABOUT the event, it IS the event. The first real board threw
 * `FORMATTING_ERROR: The intl string context variable "kind" was not provided`.
 * kp writes 11 pipeline kinds render-keys.ts has no word for, so that path is
 * ordinary traffic rather than an edge case.
 *
 * `rawMessage` is the resolved message for the key, which the caller has and this
 * function does not; it is only needed for a rail step, which has no facts.
 */
export function journeySentenceArgs(
  event: SentenceEvent,
  rawMessage?: string
): { key: string; values: Record<string, string | number> } {
  const key = journeyEventMessageKey(event);
  const values =
    event.facts === undefined ? stepPlaceholders(rawMessage ?? "") : icuValues(event.facts);
  // `kind` is RESERVED for the one message whose argument is the event's own
  // kind. Every other message names its arguments after facts (see `gate` on
  // approvalSet), so the two can never be confused again.
  return key === UNKNOWN_KEY ? { key, values: { ...values, kind: event.kind } } : { key, values };
}

export function useJourneySentence(): (event: SentenceEvent) => string {
  const t = useTranslations("journey");
  type Key = Parameters<typeof t>[0];
  return useCallback(
    (event: SentenceEvent) => {
      // The key is decided at runtime from a ledger value, so the cast at this
      // boundary is the same one `useErrorMessage` makes for an error code —
      // guarded by the `has` check, never blind.
      const resolved = journeyEventMessageKey(event);
      const key = (t.has(resolved as Key) ? resolved : UNKNOWN_KEY) as Key;
      // The message itself is what says which arguments are owed; reading it here
      // is what lets a rail step supply a REAL value for each of them.
      const raw = typeof t.raw(key) === "string" ? (t.raw(key) as string) : "";
      const { values } = journeySentenceArgs({ ...event, kind: event.kind }, raw);
      const withKind = key === UNKNOWN_KEY ? { ...values, kind: event.kind } : values;
      return t(key, withKind as never);
    },
    [t]
  );
}
