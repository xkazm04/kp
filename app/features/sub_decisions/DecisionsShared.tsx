import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge, interviewRecommendationToken } from "@/app/_components/Badge";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { INTERVIEW_RECOMMENDATION_FALLBACK, type InterviewRecommendation } from "@/app/_lib/interview-recommendation";
import { STAGES, styleFor, type Entry } from "./DecisionsTypes";
import { initials } from "@/app/_lib/initials";

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-stone-200 p-3 text-sm text-steel">{children}</p>;
}

export function NextStage({ stage }: { stage: string }) {
  const enumLabel = useEnumLabel();
  const idx = STAGES.indexOf(stage);
  const next = STAGES[Math.min(idx + 1, STAGES.length - 1)];
  return (
    <span className="inline-flex items-center gap-1 text-sm text-steel">
      <span className="rounded bg-stone-100 px-1.5 py-0.5">{enumLabel("stage", stage)}</span>
      <ChevronRight size={12} />
      <span className="rounded bg-moss/10 px-1.5 py-0.5 font-semibold text-moss">{enumLabel("stage", next)}</span>
    </span>
  );
}

export function CandidateHead({ entry }: { entry: Entry }) {
  const t = useTranslations("decisions");
  const enumLabel = useEnumLabel();
  const s = styleFor(entry.archetype);
  const monogram = initials(entry.candidateLabel);
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
      {entry.matchScore != null ? (
        <span className="ml-auto inline-flex items-center gap-1.5">
          <ScoreBadge score={entry.matchScore} />
          <span className="text-sm uppercase text-steel">{t("match")}</span>
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
