// Score tone → class, shared by every layer of the map so a strong candidate is the
// same green on the board, the orchard tickets and the candidate detail.

import type { ScoreTone } from "@/app/_lib/format";

export const TONE_TEXT: Record<ScoreTone, string> = {
  strong: "text-score-strong",
  mid: "text-score-mid",
  weak: "text-score-weak",
  null: "text-score-null",
};

export const TONE_BAR: Record<ScoreTone, string> = {
  strong: "bg-score-strong",
  mid: "bg-score-mid",
  weak: "bg-score-weak",
  null: "bg-score-null",
};
