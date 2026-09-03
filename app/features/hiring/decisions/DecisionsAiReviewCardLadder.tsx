"use client";

// The AI-review card's "Ladder" body (winner of the /prototype round,
// 2026-08-10) — the comparative block that replaced the AI's prose on
// screening/scorecard cards (the narrative moved into the Full-analysis
// modal's AI-review section). Answers "how does this candidate sit against
// the rest of this role's pipeline" at the card itself:
//   • a ranked mini-leaderboard of same-job active peers (self row
//     highlighted; stage chips carry where each rival currently stands),
//   • the salary expectation plotted against the role band (peer-context
//     facts; renders only for a same-currency pair),
//   • the scorecard rubric dots (the rubric IS data, so it stays).
// Honest by construction: no ladder without 2+ scored peers, no salary plot
// without a comparable band. Offer cards never render this — their
// band + deadline body (DecisionsAiReviewCardBody) is decision-critical.
import { useTranslations } from "next-intl";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { APP_CURRENCY, RATING_MAX } from "@/app/_lib/format";
import type { Entry } from "@/app/features/shared/decisionsTypes";
import type { JobPeerContext, PeerScore } from "./decisionsPeerCompare";
import { SalaryBandRail } from "./DecisionsPeerViz";
import type { ParsedApproval } from "./decisionsAiReviewCardLogic";

const RATING_SCALE = Array.from({ length: RATING_MAX }, (_, i) => i + 1);
const LADDER_CAP = 4;

/** The scorecard rubric dots — data, not prose, so they survive the ladder. */
function RatingDots({ parsed }: { parsed: ParsedApproval }) {
  if (!parsed.ratings?.length) return null;
  return (
    <ul className="space-y-1">
      {parsed.ratings.slice(0, 4).map((r, i) => (
        <li key={i} className="flex items-center justify-between gap-2">
          <span className="truncate text-sm text-steel">{r.competency}</span>
          <span className="flex shrink-0 gap-0.5">
            {RATING_SCALE.map((n) => (
              <span key={n} className={`h-1.5 w-1.5 rounded-full ${n <= r.rating ? "bg-moss" : "bg-stone-200"}`} />
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AiReviewCardLadder({
  entry,
  parsed,
  isScorecard,
  peers,
  peerFacts,
}: {
  entry: Entry;
  parsed: ParsedApproval;
  isScorecard: boolean;
  peers: PeerScore[];
  peerFacts: JobPeerContext | null;
}) {
  const t = useTranslations("decisions.summary");
  const own = peerFacts?.byEntry[entry.id] ?? null;
  const salary = own?.salary ?? null;
  const band = peerFacts?.salaryBand ?? null;
  const scored = peers.filter((p): p is PeerScore & { score: number } => p.score != null).sort((a, b) => b.score - a.score);
  const selfIdx = scored.findIndex((p) => p.entryId === entry.id);
  // Keep the self row visible even when it ranks below the cap.
  const rows = scored.slice(0, LADDER_CAP);
  if (selfIdx >= LADDER_CAP) rows.splice(LADDER_CAP - 1, 1, scored[selfIdx]);
  return (
    <div className="mt-2 rounded-md border border-stone-200 bg-paper/50 p-2.5">
      {scored.length >= 2 && selfIdx >= 0 ? (
        <>
          <ul className="space-y-0.5">
            {rows.map((p) => {
              const self = p.entryId === entry.id;
              const rank = scored.indexOf(p) + 1;
              return (
                <li key={p.entryId} className={`flex items-center gap-2 rounded px-1.5 py-1 ${self ? "bg-coral/5 ring-1 ring-coral/30" : ""}`}>
                  <span className="nums w-4 shrink-0 text-sm font-semibold text-steel">{rank}</span>
                  <span className={`min-w-0 flex-1 truncate text-sm ${self ? "font-semibold text-ink" : "text-steel"}`}>{p.label}</span>
                  {!self && p.stage ? <span className="shrink-0 rounded bg-stone-100 px-1 text-meta uppercase text-steel">{p.stage}</span> : null}
                  <ScoreBadge score={p.score} />
                </li>
              );
            })}
          </ul>
          {/* "+N more in this pipeline" is counted against ALL active peers on the
              role (peersForEntry's set), not against `scored`: the ladder ranks only
              candidates that carry a score, so counting the overflow over the scored
              subset silently dropped every unscored peer from a line whose own label
              claims the pipeline. A role with 8 active candidates, 6 scored, showing
              the 4-row cap read "+2 more" when 4 more were in the pipeline. */}
          {peers.length > rows.length ? <p className="mt-1 px-1.5 text-sm text-steel">{t("moreInPipeline", { count: peers.length - rows.length })}</p> : null}
        </>
      ) : (
        <p className="text-sm text-steel">{t("noScoredPeers")}</p>
      )}
      {salary && band ? (
        <div className="mt-2 border-t border-stone-200 pt-2">
          <SalaryBandRail band={band} salary={salary} bandCurrency={APP_CURRENCY} />
        </div>
      ) : null}
      {isScorecard ? (
        <div className="mt-2 border-t border-stone-200 pt-2">
          <RatingDots parsed={parsed} />
        </div>
      ) : null}
    </div>
  );
}
