"use client";

// The analysis modal's evidence sections: matched/missing role skills (with
// provenance), the claimed-but-unproven bucket, and the candidate's profile
// facts (skills/aspirations/languages/education). Split out of
// DecisionsAnalysisSummaryModal so the modal shell stays under 200 lines.
import { useTranslations } from "next-intl";
import { provLabel } from "@/app/features/shared/matchTypes";
import type { AnalysisPayload, MatchView } from "./decisionsAnalysisSummaryData";

export function DecisionsAnalysisSummaryBody({
  match,
  matchProv,
  unproven,
  unprovenReason,
  unprovenStrength,
  unprovenLabelKey,
  loading,
  payload,
  skills,
  t,
  enumLabel,
}: {
  match: MatchView | null;
  matchProv: Record<string, string>;
  unproven: string[];
  unprovenReason: Record<string, string | undefined>;
  unprovenStrength: Record<string, number | undefined>;
  unprovenLabelKey: (reason: string | undefined) => "unprovenAdjacency" | "unprovenProvenance" | "unprovenBoth" | "unprovenClaimed";
  loading: boolean;
  payload: AnalysisPayload | null;
  skills: string[];
  t: ReturnType<typeof useTranslations<"decisions.summary">>;
  enumLabel: (group: string, value: string) => string;
}) {
  return (
    <>
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

      {/* Claimed but UNPROVEN — the near-miss / unsubstantiated bucket, kept
          visually distinct from a clean match (amber, not green) with the reason
          spelled out so a "close" candidate isn't mistaken for a proven one. */}
      {unproven.length > 0 ? (
        <div className="mt-4">
          <p className="text-meta uppercase tracking-wide text-steel">{t("unprovenTitle")}</p>
          <p className="mt-0.5 text-sm text-steel">{t("unprovenHelp")}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
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
    </>
  );
}
