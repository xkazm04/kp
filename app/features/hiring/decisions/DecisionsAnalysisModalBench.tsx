"use client";

// The Full-analysis modal's "Bench" layout — the peer-comparison workspace
// (winner of the /prototype round, 2026-08-10). The near-fullscreen modal
// treats the decision as a FIELD question, not a file question: a verdict band
// up top, then a ranked bench of the role's other candidates (the rows the
// candidates fetch already returns) right beside this candidate's evidence, so
// "advance or reject" is answered relative to who else is actually available.
// Divided by section bands; evidence in two columns.
import { Crown, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { DIVIDER, META_LABEL } from "@/app/_components/ui/recipes";
import { ScoreBreakdown } from "@/app/features/shared/MatchPresentation";
import { PeerScoreRail, RankChips } from "./DecisionsPeerViz";
import { peerStanding, type PeerScore } from "./decisionsPeerCompare";
import type { PeerRow } from "./decisionsAnalysisSummaryData";
import {
  AiNarrative,
  DecisionFooter,
  DecisionNoteField,
  FactChips,
  FitReadout,
  ProfileFacts,
  RoleSkillsChips,
  SectionBand,
  UnprovenChips,
  type AnalysisVariantProps,
} from "./DecisionsAnalysisParts";

const BENCH_CAP = 6;

function BenchRow({ peer, rank, self }: { peer: PeerRow | null; rank: number; self?: { label: string; total: number | null; matched: number | null } }) {
  const t = useTranslations("decisions.summary");
  const total = self ? self.total : peer?.result.total ?? null;
  const matched = self ? self.matched : peer?.result.matchedSkills?.length ?? null;
  return (
    <li className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${self ? "bg-coral/5 ring-1 ring-coral/30" : ""}`}>
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink/85 text-sm font-semibold text-white nums">{rank}</span>
      <span className={`min-w-0 flex-1 truncate text-sm ${self ? "font-semibold text-ink" : "text-ink"}`}>
        {self ? self.label : peer?.label}
        {rank === 1 ? <Crown size={12} className="ml-1 inline text-moss" aria-hidden /> : null}
      </span>
      {matched != null ? (
        <span className="nums shrink-0 text-sm text-steel" title={t("matchedRoleSkillsTitle")}>
          {t("matchedCountGlyph", { matched })}
        </span>
      ) : null}
      <ScoreBadge score={total} />
    </li>
  );
}

export function AnalysisModalBench({ entry, data, reason, setReason, onClose, onAccept, onReject, t, enumLabel }: AnalysisVariantProps) {
  const { match, matchLoading, peers, unproven } = data;
  const total = match?.total ?? entry.matchScore ?? null;

  const rows: PeerScore[] = [
    { entryId: entry.id, label: entry.candidateLabel, stage: entry.stage, score: total },
    ...peers.map((p) => ({ entryId: p.candidateId, label: p.label, stage: "", score: p.result.total ?? null })),
  ];
  const standing = total != null ? peerStanding(rows, entry.id) : null;

  // The bench: this candidate + peers, ranked by score, capped for scanability.
  const ranked: { peer: PeerRow | null; score: number | null }[] = [
    { peer: null, score: total },
    ...peers.map((p) => ({ peer: p as PeerRow | null, score: p.result.total ?? null })),
  ].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const selfRank = ranked.findIndex((r) => r.peer === null);
  // Keep the self row visible even when it ranks below the cap.
  const bench = ranked.slice(0, BENCH_CAP);
  if (selfRank >= BENCH_CAP) bench.splice(BENCH_CAP - 1, 1, ranked[selfRank]);

  return (
    <Modal
      size="full"
      title={entry.candidateLabel}
      subtitle={entry.jobTitle ?? undefined}
      onClose={onClose}
      footer={<DecisionFooter reason={reason} onAccept={onAccept} onReject={onReject} t={t} />}
    >
      {/* Verdict band */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 bg-paper/40 p-4">
        <FitReadout data={data} entry={entry} t={t} />
        <FactChips data={data} t={t} enumLabel={enumLabel} />
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* ── Evidence, two ruled columns on wide screens ── */}
        <div className="-mx-5 min-w-0 lg:mx-0">
          {entry.approvalDetail ? (
            <>
              <SectionBand label={t("aiReview")} />
              <div className="px-5 py-4 lg:px-3">
                <AiNarrative entry={entry} />
              </div>
            </>
          ) : null}
          <SectionBand label={t("whereFit")} />
          <div className="px-5 py-4 lg:px-3">
            {match?.scoreBreakdown?.length ? (
              <div className="max-w-xl">
                <ScoreBreakdown dims={match.scoreBreakdown} total={match.total} />
              </div>
            ) : matchLoading ? (
              <p className="flex items-center gap-2 text-sm text-steel">
                <Loader2 size={14} className="animate-spin text-coral" /> {t("scoringRole")}
              </p>
            ) : null}
          </div>

          <SectionBand label={t("roleSkills")} />
          <div className="grid gap-x-8 gap-y-4 px-5 py-4 sm:grid-cols-2 lg:px-3">
            <div>
              <RoleSkillsChips data={data} t={t} enumLabel={enumLabel} />
            </div>
            {unproven.length > 0 ? (
              <div>
                <p className={META_LABEL}>{t("unprovenTitle")}</p>
                <div className="mt-1.5">
                  <UnprovenChips data={data} t={t} />
                </div>
              </div>
            ) : null}
          </div>

          <SectionBand label={t("candidateProfile")} />
          <div className="px-5 py-4 lg:px-3">
            <ProfileFacts data={data} t={t} />
          </div>
        </div>

        {/* ── The bench: who else is on this role ── */}
        <aside className="self-start rounded-lg border border-stone-200 bg-white p-4 shadow-panel lg:sticky lg:top-0">
          <p className={META_LABEL}>{t("field", { count: rows.length })}</p>
          {standing && total != null ? (
            <>
              <PeerScoreRail self={total} peers={peers.map((p) => p.result.total).filter((s): s is number => s != null)} className="mt-3" />
              <div className="mt-2">
                <RankChips standing={standing} />
              </div>
            </>
          ) : null}
          {peers.length > 0 ? (
            <ul className={`${DIVIDER} mt-3 space-y-1 pt-3`}>
              {bench.map((r) => {
                const rank = ranked.indexOf(r) + 1;
                return r.peer === null ? (
                  <BenchRow key="self" peer={null} rank={rank} self={{ label: entry.candidateLabel, total, matched: match?.matchedSkills?.length ?? null }} />
                ) : (
                  <BenchRow key={r.peer.candidateId} peer={r.peer} rank={rank} />
                );
              })}
              {ranked.length > bench.length ? <li className="px-2 text-sm text-steel">{t("moreRanked", { count: ranked.length - bench.length })}</li> : null}
            </ul>
          ) : matchLoading ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-steel">
              <Loader2 size={14} className="animate-spin text-coral" /> {t("scoringRole")}
            </p>
          ) : (
            <p className="mt-3 text-sm text-steel">{t("summaryNote")}</p>
          )}
        </aside>
      </div>

      <DecisionNoteField reason={reason} setReason={setReason} t={t} className={`${DIVIDER} mt-5 pt-4`} />
    </Modal>
  );
}
