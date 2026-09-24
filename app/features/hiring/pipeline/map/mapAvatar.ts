// The avatar grammar shared by the map board and its overlay, so a candidate looks
// the SAME on both layers: initials inside, fill = gender hint, ring = score tone.
//
// GENDER IS NOT IN THE DATA. The pipeline deliberately redacts gender-coded
// signals before a model ever sees a CV (pipeline/jobfit/redact.py) and the
// rejection-feedback linter refuses gendered wording. Nothing on Entry or on the
// profile payload says "male"/"female". This module therefore returns a HINT
// derived from the Czech surname morphology the seed corpus uses (-ová / -á
// feminine forms) and "unknown" for everything else. It shipped with the board as
// a labelled stand-in (the legend says "gender hint"); whether the board should
// colour avatars by gender at all is a fairness/AI-Act decision still to take
// deliberately (docs/features/compliance/) — it is listed as a Known gap.

import { scoreTone, type ScoreTone } from "@/app/_lib/format";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import type { CardTier } from "./mapTypes";

export type GenderHint = "f" | "m" | "unknown";

/** Two-letter initials from a label ("Jana Nováková" → "JN"; "jn" → "JN";
 *  an id-like label → its first two characters). */
export function initialsOf(label: string): string {
  const words = label.trim().split(/[\s\-_.]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Czech-morphology gender hint (see header). Case/diacritic tolerant. */
export function genderHintOf(label: string): GenderHint {
  const last = label.trim().split(/\s+/).pop()?.toLowerCase() ?? "";
  if (last.length < 3) return "unknown";
  // Feminine surname forms: -ová (Nováková), adjectival -á (Veselá), -ská/-cká.
  if (/(ová|ova|ská|ska|cká|cka)$/.test(last) || /[áa]$/.test(last)) return "f";
  // A surname ending in a consonant (Novák, Dvořák, Pokorný is -ý: adjectival
  // masculine) reads masculine in Czech morphology.
  if (/[^aeiouáéíóúůyý]$/.test(last) || /[ýy]$/.test(last)) return "m";
  return "unknown";
}

/** The score the board ranks on: canonical (freshest job-matched analysis) first,
 *  then the snapshot, else null. Same precedence as CandidateHead. */
export function boardScoreOf(e: Pick<Entry, "canonicalScore" | "matchScore">): number | null {
  return e.canonicalScore ?? e.matchScore ?? null;
}

/** Avatar FILL by gender hint — tokens only, both themes. steel = feminine,
 *  moss = masculine, stone = unknown. (Prototype encoding; see header.) */
export const AVATAR_FILL: Record<GenderHint, string> = {
  f: "bg-steel/15 text-steel dark:bg-steel/25",
  m: "bg-moss/15 text-moss dark:bg-moss/25",
  unknown: "bg-stone-100 text-stone-400",
};

/** Avatar RING by score tone — a null score draws a thin neutral ring so "no
 *  score yet" is visibly different from "weak". */
export const AVATAR_RING: Record<ScoreTone, string> = {
  strong: "ring-2 ring-score-strong",
  mid: "ring-2 ring-score-mid",
  weak: "ring-2 ring-score-weak",
  null: "ring-1 ring-stone-300",
};

export type AvatarModel = {
  initials: string;
  gender: GenderHint;
  score: number | null;
  tone: ScoreTone;
  /** Composed fill + ring classes; add size/shape classes at the call site. */
  className: string;
};

export function avatarModelOf(e: Entry): AvatarModel {
  const score = boardScoreOf(e);
  const tone = scoreTone(score);
  const gender = genderHintOf(e.candidateLabel);
  return {
    initials: initialsOf(e.candidateLabel),
    gender,
    score,
    tone,
    className: `${AVATAR_FILL[gender]} ${AVATAR_RING[tone]}`,
  };
}

/** Card density from how many cards share the overlay. The cutoffs are
 *  tuned for a ~1440px viewport: 5 cards can be full dossiers,
 *  12 still carry bars, 40 are chips, beyond that every card is an avatar+score. */
export function cardTierOf(count: number): CardTier {
  if (count <= 5) return "spacious";
  if (count <= 12) return "regular";
  if (count <= 40) return "compact";
  return "micro";
}

/** Sort for every overlay: best score first, null scores last, then by label so
 *  the order is stable across polls. */
export function sortByScore(entries: readonly Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    const sa = boardScoreOf(a);
    const sb = boardScoreOf(b);
    if (sa == null && sb == null) return a.candidateLabel.localeCompare(b.candidateLabel);
    if (sa == null) return 1;
    if (sb == null) return -1;
    return sb - sa || a.candidateLabel.localeCompare(b.candidateLabel);
  });
}
