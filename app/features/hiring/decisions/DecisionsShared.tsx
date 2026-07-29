import { useTranslations } from "next-intl";
import { Badge, interviewRecommendationToken } from "@/app/_components/Badge";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { ScoreProvenanceLabel } from "@/app/_components/ScoreProvenanceLabel";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { canonicalScoreOf, provenanceOf } from "@/app/_lib/match-score";
import { INTERVIEW_RECOMMENDATION_FALLBACK, type InterviewRecommendation } from "@/app/_lib/interview-recommendation";
import { STAGES, styleFor, type Entry } from "@/app/features/shared/decisionsTypes";
import { initials } from "@/app/_lib/initials";

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-stone-200 p-3 text-sm text-steel">{children}</p>;
}

export function CandidateHead({ entry }: { entry: Entry }) {
  const t = useTranslations("decisions");
  const enumLabel = useEnumLabel();
  const s = styleFor(entry.archetype);
  const monogram = initials(entry.candidateLabel);
  // Canonical match-score read path (REC-01 / OO-L2-10): ONE number, with its
  // provenance named right under it, instead of a bare "57 MATCH" that silently
  // disagreed with the offer rationale and the drawer timeline.
  const score = canonicalScoreOf(entry);
  const provenance = provenanceOf(entry);
  return (
    <div className="flex items-center gap-2">
      <span className={`grid h-9 w-9 place-items-center rounded-full text-sm font-semibold text-white ${s.bg}`}>
        {monogram}
      </span>
      <div className="min-w-0">
        <p className="truncate text-base font-semibold text-ink">{entry.candidateLabel}</p>
        <p className="truncate text-sm text-steel">
          {enumLabel("archetype", entry.archetype)} · {entry.jobTitle}
        </p>
      </div>
      {score != null ? (
        <span className="ml-auto flex shrink-0 flex-col items-end gap-0.5">
          <span className="inline-flex items-center gap-1.5">
            <ScoreBadge score={score} />
            <span className="text-sm uppercase text-steel">{t("match")}</span>
          </span>
          <ScoreProvenanceLabel provenance={provenance} />
        </span>
      ) : null}
    </div>
  );
}

export function MiniList({ title, items, tone }: { title: string; items: string[]; tone: "green" | "red" }) {
  const dot = tone === "green" ? "text-moss" : "text-coral";
  return (
    <div>
      <p className="text-sm font-semibold uppercase tracking-wide text-steel">{title}</p>
      <ul className="mt-0.5 space-y-0.5">
        {items.slice(0, 3).map((it, i) => (
          <li key={i} className="flex gap-1 text-sm text-ink">
            <span className={dot}>•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Recruiter triage verdict (advance / hold / reject) — reuses the canonical
// Badge token so it carries an icon + accessible label, not color alone, and
// looks identical to the same verdict everywhere else (e.g. the interview
// scorecard). The optional "· {confidence}%" suffix stays tabular-nums.
export function RecBadge({ rec, confidence }: { rec?: InterviewRecommendation; confidence?: number }) {
  const t = useTranslations("decisions");
  const enumLabel = useEnumLabel();
  const resolved = rec ?? INTERVIEW_RECOMMENDATION_FALLBACK;
  // Icon + tone come from the canonical Badge token; the visible label is
  // localized via the enums catalog (the verdict value stays canonical).
  const content = interviewRecommendationToken(resolved);
  const label = enumLabel("recommendation", resolved);
  const hasConfidence = typeof confidence === "number";
  return (
    <Badge
      {...content}
      label={hasConfidence ? t("recConfidenceSuffix", { label, confidence }) : label}
      ariaLabel={hasConfidence ? t("recAriaConfidence", { label, confidence }) : t("recAria", { label })}
      className="tabular-nums"
    />
  );
}
