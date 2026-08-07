"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { TextArea } from "@/app/_components/TextArea";
import { ConfidenceBandBadge, ConfidenceRange, FitTierBadge } from "@/app/_components/Badge";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ScoreBreakdown } from "@/app/features/sub_match/MatchShared";
import { provLabel, type MatchResultView } from "@/app/features/sub_match/MatchTypes";
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
// decision carries the same evidence the comparison matrix does. The shared
// recruiter result view (MatchResultView), single-sourced from MatchTypes.
type MatchView = MatchResultView;
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
  // The optional decision note (DEC4) the recruiter typed below — recorded on the
  // advanced/rejected event and shown in the Decision Log.
  onAccept: (reason?: string) => void;
  onReject: (reason?: string) => void;
}) {
  const t = useTranslations("decisions.summary");
  const enumLabel = useEnumLabel();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [reason, setReason] = useState("");
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
            onClick={() => onReject(reason)}
            className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-coral hover:bg-coral/5"
          >
            <X size={15} /> {t("reject")}
          </button>
          <button
            type="button"
            onClick={() => onAccept(reason)}
            className="focus-ring inline-flex h-9 items-center gap-1 rounded-md bg-moss px-3 text-sm font-semibold text-white hover:opacity-90"
          >
            <Check size={15} /> {t("advance")}
          </button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
          {t("fit")} <ScoreBadge score={match?.total ?? entry.matchScore ?? null} />
        </span>
        <FitTierBadge tier={match?.fitTier} score={match?.total ?? entry.matchScore ?? undefined} />
        {match?.confidence ? (
          <span className="inline-flex items-center gap-1.5">
            <ConfidenceRange low={match.confidence.low} high={match.confidence.high} drivers={match.confidence.drivers} className="nums text-sm text-steel" />
            <ConfidenceBandBadge level={match.confidence.level} drivers={match.confidence.drivers} />
          </span>
        ) : null}
        {payload?.seniority ? <span className="rounded-md bg-paper px-2 py-1 text-sm text-ink">{enumLabel("seniority", payload.seniority)}</span> : null}
        {payload?.yearsExperience != null ? (
          <span className="rounded-md bg-paper px-2 py-1 text-sm text-ink">{t("years", { years: payload.yearsExperience })}</span>
        ) : null}
        {payload?.educationLevel ? <span className="rounded-md bg-paper px-2 py-1 text-sm text-ink">{enumLabel("education", payload.educationLevel)}</span> : null}
        {payload?.location ? <span className="rounded-md bg-paper px-2 py-1 text-sm text-steel">{payload.location}</span> : null}
      </div>

      {/* Weight-aware score breakdown for this role (where the fit comes from). */}
      {match?.scoreBreakdown?.length ? (
        <div className="mt-4">
          <p className="text-meta uppercase tracking-wide text-steel">{t("whereFit")}</p>
          <ScoreBreakdown dims={match.scoreBreakdown} total={match.total} />
        </div>
      ) : matchLoading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-steel">
          <Loader2 size={14} className="animate-spin text-coral" /> {t("scoringRole")}
        </p>
      ) : null}

      {/* Matched / missing skills for the role, with evidence provenance. */}
      {match && ((match.matchedSkills?.length ?? 0) > 0 || (match.missingSkills?.length ?? 0) > 0) ? (
        <div className="mt-4">
          <p className="text-meta uppercase tracking-wide text-steel">{t("roleSkills")}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(match.matchedSkills ?? []).map((s) => {
              const pl = provLabel(matchProv[s] ?? "self_declared");
              const strength = match.matchedSkillStrength?.[s];
              return (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 rounded bg-green-50 px-1.5 py-0.5 text-sm text-green-700"
                  title={strength != null ? t("skillStrengthTitle", { pct: Math.round(strength * 100) }) : undefined}
                >
                  {s}
                  <span className={`rounded px-1 text-[10px] uppercase ${pl.tone}`}>{enumLabel("provenance", pl.key)}</span>
                </span>
              );
            })}
            {(match.missingSkills ?? []).map((s) => (
              <span key={`x-${s}`} className="rounded bg-red-50 px-1.5 py-0.5 text-sm text-red-700">
                {`✗ ${s}`}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-steel">{t("loadingAnalysis")}</p>
      ) : (
        <div className="mt-4 space-y-4">
          {skills.length ? (
            <div>
              <p className="text-meta uppercase tracking-wide text-steel">{t("profileSkills")}</p>
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
              <p className="text-meta uppercase tracking-wide text-steel">{t("aspirations")}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink">
                {payload.aspirations.slice(0, 4).map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {payload?.languages?.length ? (
            <p className="text-sm text-steel">
              <span className="font-semibold text-ink">{t("languagesLabel")}</span> {payload.languages.join(", ")}
            </p>
          ) : null}
          {payload?.educationDetail ? (
            <p className="text-sm text-steel">
              <span className="font-semibold text-ink">{t("educationLabel")}</span> {payload.educationDetail}
            </p>
          ) : null}

          <p className="text-sm text-steel">{t("summaryNote")}</p>
        </div>
      )}

      <div className="mt-4 border-t border-stone-200 pt-4">
        <label htmlFor="decision-note" className="text-meta uppercase tracking-wide text-steel">
          {t("decisionNote")} <span className="font-normal normal-case text-steel/70">{t("decisionNoteOptional")}</span>
        </label>
        <TextArea
          id="decision-note"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder={t("notePlaceholder")}
          sizeVariant="sm"
          className="mt-1.5"
        />
      </div>
    </Modal>
  );
}
