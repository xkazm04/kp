"use client";

import { useTranslations } from "next-intl";
import { Mark, type MarkKind, type Provenance } from "@/app/_components/kit";
import type { JourneyEvent, JourneyOrigin } from "@/app/_lib/journey/types";
import { ACTOR_MARK_KEY, rowProvenance, type ActorKind } from "../journeyMarks";

const ACTOR_MARK: Record<ActorKind, MarkKind> = { human: "human", machine: "machine", unidentified: "nobody" };

/**
 * The kit's text provenance for one row. Generated = the column came from a test run (italic);
 * name-only = attached by a name match alone ("≈" + wavy). The Broadsheet drew BOTH as "not
 * observed" italics and read a live name-only row aloud as "From a test run"; here each keeps its
 * own mark, and a row that is both carries both (see `textClass`).
 */
export function provenanceOf(event: JourneyEvent, origin: JourneyOrigin | undefined): Provenance {
  const p = rowProvenance(event, origin);
  if (p.labelOnly) return "name-only";
  return p.fromTestRun ? "generated" : "observed";
}

/** The class list for a row's sentence: `k-gen` (italic) for generated, `k-approx` for name-only. */
export function textClass(event: JourneyEvent, origin: JourneyOrigin | undefined): string {
  const p = rowProvenance(event, origin);
  return [p.fromTestRun ? "k-gen" : "", p.labelOnly ? "k-approx" : ""].filter(Boolean).join(" ");
}

/** The row's provenance in the catalog's words: who acted, then what kind of row it is. */
export function provenanceWords(event: JourneyEvent, origin: JourneyOrigin | undefined, t: (k: "mark.human" | "mark.machine" | "mark.unidentified" | "mark.observed" | "mark.testRun" | "mark.labelOnly") => string): string {
  const p = rowProvenance(event, origin);
  const words = [t(ACTOR_MARK_KEY[p.actor])];
  if (p.fromTestRun) words.push(t("mark.testRun"));
  if (p.labelOnly) words.push(t("mark.labelOnly"));
  if (p.observed) words.push(t("mark.observed"));
  return words.join(". ");
}

/**
 * One journey row's actor mark, the Broadsheet's glyph vocabulary on the kit's Mark: a human is a
 * filled disc, the machine a filled square, an actor kp cannot name the dashed hollow "nobody"; a
 * generated row (a test run) draws the human/machine mark hollow. Its
 * tip says all of it in the catalog's words, so none of it is colour or shape alone.
 */
export function EventMark({ event, origin }: { event: JourneyEvent; origin: JourneyOrigin | undefined }) {
  const t = useTranslations("journey");
  const p = rowProvenance(event, origin);
  return <Mark kind={ACTOR_MARK[p.actor]} hollow={p.fromTestRun} tip={provenanceWords(event, origin, t)} />;
}
