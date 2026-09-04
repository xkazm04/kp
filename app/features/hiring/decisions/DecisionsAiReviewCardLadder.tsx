"use client";

// The AI-review card's "Ladder" body (winner of the /prototype round,
// 2026-08-10) — the comparative block that replaced the AI's prose on
// screening/scorecard cards (the narrative moved into the Full-analysis
// modal's AI-review section). Answers "how does this candidate sit against
// the rest of this role's pipeline" at the card itself:
//   • the role's full ranked ladder of scored active peers (self row highlighted
//     and centred on open; stage chips carry where each rival currently stands),
//     scrolling past four rows so the card still fits its decision buttons,
//   • the salary expectation plotted against the role band (peer-context
//     facts; renders only for a same-currency pair),
//   • the scorecard rubric dots (the rubric IS data, so it stays).
// Honest by construction: no ladder without 2+ scored peers, no salary plot
// without a comparable band. Offer cards never render this — their
// band + deadline body (DecisionsAiReviewCardBody) is decision-critical.
import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { APP_CURRENCY, RATING_MAX } from "@/app/_lib/format";
import type { Entry } from "@/app/features/shared/decisionsTypes";
import type { JobPeerContext, PeerScore } from "./decisionsPeerCompare";
import { SalaryBandRail } from "./DecisionsPeerViz";
import type { ParsedApproval } from "./decisionsAiReviewCardLogic";

const RATING_SCALE = Array.from({ length: RATING_MAX }, (_, i) => i + 1);
/** Rows visible without scrolling. Past this the list scrolls, centred on self. */
const LADDER_VISIBLE = 4;
/** 4 rows at ~30px + the list's own padding — the cap that turns the list into a
 *  scroller. A ladder taller than this pushes the accept/reject buttons off a
 *  queue card whose whole job is to be decided at a glance. */
const LADDER_MAX_H = "max-h-[7.5rem]";

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
  // EVERY scored peer is rendered, not a top-4 slice with the self row spliced in.
  // The slice answered "who leads this role"; a reviewer deciding on THIS person is
  // asking the neighbouring question — who sits immediately above and below them —
  // and the splice deleted exactly that: a candidate ranked 7th was shown against
  // ranks 1-3 and nobody they were actually close to. So the list keeps its full
  // ranking and scrolls, opening centred on the reviewed candidate (below).
  const listRef = useRef<HTMLUListElement>(null);
  const selfRef = useRef<HTMLLIElement>(null);
  const scrolls = scored.length > LADDER_VISIBLE;
  useEffect(() => {
    const list = listRef.current;
    const self = selfRef.current;
    if (!scrolls || !list || !self) return;
    // Centre the self row INSIDE the list. Deliberately not scrollIntoView: that
    // walks every scrollable ancestor and would drag the whole decisions queue
    // under the reader on mount.
    list.scrollTop = Math.max(0, self.offsetTop - list.clientHeight / 2 + self.clientHeight / 2);
  }, [scrolls, entry.id, scored.length]);

  return (
    <div className="mt-2 rounded-md border border-stone-200 bg-paper/50 p-2.5">
      {scored.length >= 2 && selfIdx >= 0 ? (
        <>
          {/* `relative` so a row's offsetTop is measured against THIS list (the
              centring maths above), not against some outer positioned ancestor. */}
          <ul
            ref={listRef}
            className={`relative space-y-0.5 ${scrolls ? `${LADDER_MAX_H} overflow-y-auto pr-1` : ""}`}
          >
            {scored.map((p) => {
              const self = p.entryId === entry.id;
              const rank = scored.indexOf(p) + 1;
              return (
                <li
                  key={p.entryId}
                  ref={self ? selfRef : undefined}
                  className={`flex items-center gap-2 rounded px-1.5 py-1 ${self ? "bg-coral/5 ring-1 ring-coral/30" : ""}`}
                >
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
              candidates that CARRY a score, and the rest are still in the pipeline.
              Now that every scored peer is rendered, this line names exactly the
              unscored remainder rather than a display overflow. */}
          {peers.length > scored.length ? (
            <p className="mt-1 px-1.5 text-sm text-steel">{t("moreInPipeline", { count: peers.length - scored.length })}</p>
          ) : null}
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
