// Orchard overlay copy, English-only for now. Held as constants rather than JSX text
// because this tree is at ERROR for `i18next/no-literal-string`; the copy was
// written during the prototype round and still owes four catalog entries per line
// (pipeline README, Known gaps → localisation of the map board).

import type { BranchFit, ScoreBand } from "./orchardLayout";

export const ORCHARD_COPY = {
  eyebrow: "Role · Stage",
  one: "candidate",
  many: "candidates",
  back: "Back to the board",
  dialogAria: (title: string) => `${title} — candidates in this stage`,
  matchError: "Score detail is unavailable right now — cards show the board score only.",
  emptyLane: "No scored candidate stands in this cell.",
  unscored: "Not scored yet",
  salaryCaveat: "Salary = estimated expectation, not yet from the CV",
  gems: "Gems",
  professionals: "Best professionals",
  missing: (n: number) => `${n} missing`,
  ticketAria: (name: string, score: number | null, salary: string | null) =>
    [name, score != null ? `score ${score}` : "not scored yet", salary ? `estimated ${salary}` : null]
      .filter(Boolean)
      .join(", "),
} as const;

export const BAND_LABEL: Record<ScoreBand, string> = {
  strong: "strong",
  mid: "mid",
  weak: "weak",
};

export const FIT_LABEL: Record<BranchFit, string> = {
  inside: "in band",
  above: "above band",
  below: "below band",
};
