// The ranking CSV as pure rows, so the export carries the same reasons line the card
// shows and the layout can be tested without a DOM.
import type { MatchResult } from "@/app/features/shared/matchTypes";
import { matchReasons, type MatchReasonsTranslator } from "./matchReasons";

export type MatchCsvHeaders = {
  rank: string; role: string; company: string; score: string; confLow: string; confHigh: string;
  fitTier: string; matchedSkills: string; unprovenSkills: string; missingSkills: string; reasons: string;
};

export function matchCsvRows(
  matches: readonly MatchResult[],
  headers: MatchCsvHeaders,
  tMatch: MatchReasonsTranslator
): (string | number)[][] {
  const header = [
    headers.rank, headers.role, headers.company, headers.score, headers.confLow, headers.confHigh,
    headers.fitTier, headers.matchedSkills, headers.unprovenSkills, headers.missingSkills, headers.reasons,
  ];
  const rows = matches.map((m, i) => [
    i + 1,
    m.title,
    m.company ?? "",
    m.total,
    m.confidence.low,
    m.confidence.high,
    m.fitTier ?? "",
    (m.matchedSkills ?? []).join("; "),
    (m.unprovenSkills ?? []).join("; "),
    (m.missingSkills ?? []).join("; "),
    matchReasons(m, tMatch)?.line ?? "",
  ]);
  return [header, ...rows];
}
