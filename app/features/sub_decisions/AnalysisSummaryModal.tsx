"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Modal } from "@/app/_components/Modal";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { ConfidenceBandBadge, confidenceBandTitle, FitTierBadge } from "@/app/_components/Badge";
import { ScoreBreakdown } from "@/app/features/sub_match/MatchShared";
import { provLabel, type Confidence, type ScoreDimension } from "@/app/features/sub_match/MatchTypes";
import type { Entry } from "./DecisionsTypes";

type SkillClaim = { skill?: string; level?: string; provenance?: string };
type Payload = {
  seniority?: string;
  archetype?: string;
  roleFamily?: string;
  yearsExperience?: number;
  educationLevel?: string;
  educationDetail?: string;
  location?: string;
  languages?: string[];
  aspirations?: string[];
  skillClaims?: SkillClaim[];
};

// The same full breakdown the recruiter ranker emits (matching.score_job), for
// this one candidate against this role — surfaced so the single-candidate
// decision carries the same evidence the comparison matrix does.
type MatchView = {
  total: number;
  fitTier?: "strong" | "promising" | "partial";
  confidence?: Confidence;
  scoreBreakdown?: ScoreDimension[];
  matchedSkills?: string[];
  matchedSkillProvenance?: Record<string, string>;
  matchedSkillStrength?: Record<string, number>;
  missingSkills?: string[];
};
type CandRow = { candidateId: string; result: MatchView };

// Read-only analysis summary derived from the profile data already gathered for
// this candidate (no new AI call) + the deterministic match breakdown for the
// role, with the advance/reject decision in the footer.
export function AnalysisSummaryModal({
  entry,
  onClose,
  onAccept,
  onReject,
}: {
  entry: Entry;
  onClose: () => void;
  onAccept: () => void;
  onReject: () => void;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(Boolean(entry.candidateId));
  const [match, setMatch] = useState<MatchView | null>(null);
  const [matchLoading, setMatchLoading] = useState(Boolean(entry.candidateId && entry.jobId));

  useEffect(() => {
    if (!entry.candidateId) return;
    let alive = true;
    fetch(`/api/profile?id=${encodeURIComponent(entry.candidateId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((p) => alive && setPayload((p.profile?.payload as Payload) ?? null))
      .catch(() => alive && setPayload(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [entry.candidateId]);

  // Full score breakdown for this (candidate, role) pair — the same recruiter
  // ranking the group comparison uses, filtered to this candidate. Best-effort:
  // a failure just hides the breakdown section, the profile facts stay.
  useEffect(() => {
    if (!entry.candidateId || !entry.jobId) return;
    let alive = true;
    fetch(`/api/jobs/${encodeURIComponent(entry.jobId)}/candidates`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((p) => {
        if (!alive) return;
        const row = (p.candidates as CandRow[] | undefined)?.find((c) => c.candidateId === entry.candidateId);
        setMatch(row?.result ?? null);
      })
      .catch(() => alive && setMatch(null))
      .finally(() => alive && setMatchLoading(false));
    return () => {
      alive = false;
    };
  }, [entry.candidateId, entry.jobId]);

  const skills = (payload?.skillClaims ?? []).map((c) => c.skill).filter(Boolean).slice(0, 12) as string[];
  const matchProv = match?.matchedSkillProvenance ?? {};

  return (
    <Modal
      size="3xl"
      title={entry.candidateLabel}
      subtitle={entry.jobTitle ?? undefined}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onReject}
            className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-coral hover:bg-coral/5"
          >
            <X size={15} /> Reject
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="focus-ring inline-flex h-9 items-center gap-1 rounded-md bg-moss px-3 text-sm font-semibold text-white hover:opacity-90"
          >
            <Check size={15} /> Advance
          </button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
          Fit <ScoreBadge score={match?.total ?? entry.matchScore ?? null} />
        </span>
        <FitTierBadge tier={match?.fitTier} score={match?.total ?? entry.matchScore ?? undefined} />
        {match?.confidence ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="nums text-sm text-steel" title={confidenceBandTitle(match.confidence.drivers)}>
              {match.confidence.low}–{match.confidence.high}
            </span>
            <ConfidenceBandBadge level={match.confidence.level} drivers={match.confidence.drivers} />
          </span>
        ) : null}
        {payload?.seniority ? <span className="rounded-md bg-paper px-2 py-1 text-sm text-ink">{payload.seniority}</span> : null}
        {payload?.yearsExperience != null ? (
          <span className="rounded-md bg-paper px-2 py-1 text-sm text-ink">{payload.yearsExperience} yrs</span>
        ) : null}
        {payload?.educationLevel ? <span className="rounded-md bg-paper px-2 py-1 text-sm text-ink">{payload.educationLevel}</span> : null}
        {payload?.location ? <span className="rounded-md bg-paper px-2 py-1 text-sm text-steel">{payload.location}</span> : null}
      </div>

      {/* Weight-aware score breakdown for this role (where the fit comes from). */}
      {match?.scoreBreakdown?.length ? (
        <div className="mt-4">
          <p className="text-meta uppercase tracking-wide text-steel">Where the fit comes from</p>
          <ScoreBreakdown dims={match.scoreBreakdown} total={match.total} />
        </div>
      ) : matchLoading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-steel">
          <Loader2 size={14} className="animate-spin text-coral" /> Scoring against this role…
        </p>
      ) : null}

      {/* Matched / missing skills for the role, with evidence provenance. */}
      {match && ((match.matchedSkills?.length ?? 0) > 0 || (match.missingSkills?.length ?? 0) > 0) ? (
        <div className="mt-4">
          <p className="text-meta uppercase tracking-wide text-steel">Role skills</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(match.matchedSkills ?? []).map((s) => {
              const pl = provLabel(matchProv[s] ?? "self_declared");
              const strength = match.matchedSkillStrength?.[s];
              return (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 rounded bg-green-50 px-1.5 py-0.5 text-sm text-green-700"
                  title={strength != null ? `match ${Math.round(strength * 100)}%` : undefined}
                >
                  {s}
                  <span className={`rounded px-1 text-[10px] uppercase ${pl.tone}`}>{pl.text}</span>
                </span>
              );
            })}
            {(match.missingSkills ?? []).map((s) => (
              <span key={`x-${s}`} className="rounded bg-red-50 px-1.5 py-0.5 text-sm text-red-700">
                ✗ {s}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-steel">Loading analysis…</p>
      ) : (
        <div className="mt-4 space-y-4">
          {skills.length ? (
            <div>
              <p className="text-meta uppercase tracking-wide text-steel">Profile skills</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {skills.map((s) => (
                  <span key={s} className="rounded-md bg-green-50 px-2 py-0.5 text-sm text-green-700">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {payload?.aspirations?.length ? (
            <div>
              <p className="text-meta uppercase tracking-wide text-steel">Aspirations</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink">
                {payload.aspirations.slice(0, 4).map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {payload?.languages?.length ? (
            <p className="text-sm text-steel">
              <span className="font-semibold text-ink">Languages:</span> {payload.languages.join(", ")}
            </p>
          ) : null}
          {payload?.educationDetail ? (
            <p className="text-sm text-steel">
              <span className="font-semibold text-ink">Education:</span> {payload.educationDetail}
            </p>
          ) : null}

          <p className="text-sm text-steel">Summary derived from the candidate&apos;s gathered profile data and the deterministic match breakdown for this role.</p>
        </div>
      )}
    </Modal>
  );
}
