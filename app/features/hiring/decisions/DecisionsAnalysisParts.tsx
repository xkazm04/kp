"use client";

// Shared building blocks for the Full-analysis modal (the "Bench" layout in
// DecisionsAnalysisModalBench.tsx): the verdict readout, fact chips, evidence
// sections, the AI narrative, and the decision chrome. Extracted from the
// pre-Bench modal during the /prototype round; the sections keep the original
// decisions.summary catalog keys.
import { Check, X } from "lucide-react";
import type { useTranslations } from "next-intl";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { TextArea } from "@/app/_components/TextArea";
import { ConfidenceBandBadge, ConfidenceRange, FitTierBadge } from "@/app/_components/Badge";
import { useConfidenceBandCopy, useFitTierLabels } from "@/app/features/shared/MatchPresentation";
import { provLabel } from "@/app/features/shared/matchTypes";
import type { Entry } from "@/app/features/shared/decisionsTypes";
import type { useAnalysisSummaryData } from "./decisionsAnalysisSummaryData";
import { BTN_AFFIRM } from "@/app/_components/ui/recipes";

export type SummaryData = ReturnType<typeof useAnalysisSummaryData>;
export type SummaryT = ReturnType<typeof useTranslations<"decisions.summary">>;
export type EnumLabel = (group: string, value: string) => string;

/** Everything the modal layout needs — the shell resolves data ONCE and hands
 *  it down. */
export type AnalysisVariantProps = {
  entry: Entry;
  data: SummaryData;
  reason: string;
  setReason: (v: string) => void;
  onClose: () => void;
  onAccept: (reason?: string) => void;
  onReject: (reason?: string) => void;
  t: SummaryT;
  enumLabel: EnumLabel;
};

// ---- Verdict / identity pieces --------------------------------------------

/** The headline fit readout: score badge + tier + confidence band. */
export function FitReadout({ data, entry, t }: { data: SummaryData; entry: Entry; t: SummaryT }) {
  const bandCopy = useConfidenceBandCopy();
  const fitLabels = useFitTierLabels();
  const { match } = data;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
        {t("fit")} <ScoreBadge score={match?.total ?? entry.matchScore ?? null} />
      </span>
      <FitTierBadge tier={match?.fitTier} score={match?.total ?? entry.matchScore ?? undefined} labels={fitLabels} />
      {match?.confidence ? (
        <span className="inline-flex items-center gap-1.5">
          <ConfidenceRange low={match.confidence.low} high={match.confidence.high} drivers={match.confidence.drivers} copy={bandCopy} className="nums text-sm text-steel" />
          <ConfidenceBandBadge level={match.confidence.level} drivers={match.confidence.drivers} copy={bandCopy} />
        </span>
      ) : null}
    </span>
  );
}

/** The candidate fact chips (seniority / years / education / location). */
export function FactChips({ data, t, enumLabel }: { data: SummaryData; t: SummaryT; enumLabel: EnumLabel }) {
  const { payload } = data;
  if (!payload) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {payload.seniority ? <span className="rounded-md bg-paper px-2 py-1 text-sm text-ink">{enumLabel("seniority", payload.seniority)}</span> : null}
      {payload.yearsExperience != null ? <span className="rounded-md bg-paper px-2 py-1 text-sm text-ink">{t("years", { years: payload.yearsExperience })}</span> : null}
      {payload.educationLevel ? <span className="rounded-md bg-paper px-2 py-1 text-sm text-ink">{enumLabel("education", payload.educationLevel)}</span> : null}
      {payload.location ? <span className="rounded-md bg-paper px-2 py-1 text-sm text-steel">{payload.location}</span> : null}
    </span>
  );
}

// ---- Evidence sections -----------------------------------------------------

/** Matched / missing role skills with provenance stamps. */
export function RoleSkillsChips({ data, t, enumLabel }: { data: SummaryData; t: SummaryT; enumLabel: EnumLabel }) {
  const { match, matchProv } = data;
  if (!match || ((match.matchedSkills?.length ?? 0) === 0 && (match.missingSkills?.length ?? 0) === 0)) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
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
        <span key={`x-${s}`} className="rounded bg-red-50 px-1.5 py-0.5 text-sm text-red-700">{`✗ ${s}`}</span>
      ))}
    </div>
  );
}

/** The claimed-but-unproven bucket (amber, reason-stamped). */
export function UnprovenChips({ data, t }: { data: SummaryData; t: SummaryT }) {
  const { unproven, unprovenReason, unprovenStrength, unprovenLabelKey } = data;
  if (unproven.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {unproven.map((s) => {
        const strength = unprovenStrength[s];
        return (
          <span
            key={`u-${s}`}
            className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-sm text-amber-800"
            title={strength != null ? t("unprovenStrengthTitle", { pct: Math.round(strength * 100) }) : undefined}
          >
            {s}
            <span className="rounded bg-amber-100 px-1 text-[10px] uppercase text-amber-800">{t(unprovenLabelKey(unprovenReason[s]))}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Profile facts: declared skills, aspirations, languages, education detail. */
export function ProfileFacts({ data, t }: { data: SummaryData; t: SummaryT }) {
  const { loading, payload, skills } = data;
  if (loading) return <p className="text-sm text-steel">{t("loadingAnalysis")}</p>;
  return (
    <div className="space-y-4">
      {skills.length ? (
        <div>
          <p className="text-meta uppercase tracking-wide text-steel">{t("profileSkills")}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {skills.map((s) => (
              <span key={s} className="rounded-md bg-green-50 px-2 py-0.5 text-sm text-green-700">{s}</span>
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
  );
}

/** The AI's screening/scorecard narrative (rationale + strengths/red flags),
 *  parsed from the entry's approvalDetail. This is the long-form prose the
 *  card prototypes REMOVE from the queue cards — it belongs here, one click
 *  deep, next to the evidence it argues from. Renders nothing for entries
 *  without an AI narrative (e.g. plain key decisions). */
export function AiNarrative({ entry }: { entry: Entry }) {
  let parsed: { rationale?: string; summary?: string; strengths?: string[]; redFlags?: string[] } | null = null;
  try {
    parsed = entry.approvalDetail ? JSON.parse(entry.approvalDetail) : null;
  } catch {
    parsed = null;
  }
  const prose = parsed?.rationale ?? parsed?.summary ?? null;
  if (!parsed || (!prose && !parsed.strengths?.length && !parsed.redFlags?.length)) return null;
  return (
    <div>
      {prose ? <p className="text-body text-ink">{prose}</p> : null}
      {parsed.strengths?.length || parsed.redFlags?.length ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {parsed.strengths?.length ? (
            <ul className="space-y-1">
              {parsed.strengths.slice(0, 4).map((s, i) => (
                <li key={i} className="flex gap-1.5 text-sm text-ink">
                  <span className="text-moss">•</span> {s}
                </li>
              ))}
            </ul>
          ) : null}
          {parsed.redFlags?.length ? (
            <ul className="space-y-1">
              {parsed.redFlags.slice(0, 4).map((s, i) => (
                <li key={i} className="flex gap-1.5 text-sm text-ink">
                  <span className="text-coral">•</span> {s}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---- Decision chrome -------------------------------------------------------

export function DecisionNoteField({ reason, setReason, t, className = "" }: { reason: string; setReason: (v: string) => void; t: SummaryT; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor="decision-note" className="text-meta uppercase tracking-wide text-steel">
        {t("decisionNote")} <span className="font-normal normal-case text-steel/70">{t("decisionNoteOptional")}</span>
      </label>
      <TextArea id="decision-note" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder={t("notePlaceholder")} sizeVariant="sm" className="mt-1.5" />
    </div>
  );
}

export function DecisionFooter({ reason, onAccept, onReject, t }: { reason: string; onAccept: (reason?: string) => void; onReject: (reason?: string) => void; t: SummaryT }) {
  return (
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
        className={`${BTN_AFFIRM} h-9 px-3 text-sm`}
      >
        <Check size={15} /> {t("advance")}
      </button>
    </>
  );
}

/** Section band — the GroupTr grammar (coral tick + uppercase label) lifted out
 *  of the comparison table so the modal variants share its section rhythm. */
export function SectionBand({ label, aside }: { label: string; aside?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-y border-stone-200 bg-paper/60 px-3 py-2">
      <span className="h-3.5 w-1 rounded-full bg-coral/50" aria-hidden />
      <span className="text-sm font-semibold uppercase tracking-wide text-steel">{label}</span>
      {aside}
    </div>
  );
}
