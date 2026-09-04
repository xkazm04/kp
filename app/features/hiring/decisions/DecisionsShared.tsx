import { useTranslations } from "next-intl";
import { Badge, interviewRecommendationToken } from "@/app/_components/Badge";
import { StatusChip } from "@/app/_components/StatusChip";
import { pipelineStageTone } from "@/app/_lib/status-tone";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { INTERVIEW_RECOMMENDATION_FALLBACK, type InterviewRecommendation } from "@/app/_lib/interview-recommendation";
import { STAGES, type Entry } from "@/app/features/shared/decisionsTypes";

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-stone-200 p-3 text-sm text-steel">{children}</p>;
}

// The candidate identity line: name, then archetype · role · board stage.
//
// It used to open with a coloured initials monogram and close with the match
// score + its provenance label, which left the middle column — the only part
// carrying words — about half the card's width, so "Data engineer · Senior Java
// vývojář do platebního týmu" truncated on nearly every card. The monogram
// identified nobody the name did not (these cards are one candidate each, not a
// roster), and the score moved to the card's top-right corner beside the verdict
// (DecisionsAiReviewCard), where it reads as the header fact it is. What is left
// spans the full width and wraps instead of truncating.
export function CandidateHead({ entry }: { entry: Entry }) {
  const enumLabel = useEnumLabel();
  return (
    <div className="min-w-0">
      <p className="text-base font-semibold text-ink">{entry.candidateLabel}</p>
      <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-steel">
        <span>{enumLabel("archetype", entry.archetype)} · {entry.jobTitle}</span>
        {/* ONE THREAD (gap 8) — the decision cards named the role and the
            archetype but never WHERE on the board this person is standing, which
            is exactly the fact that tells a reviewer whether "advance" means a
            screen or an offer. Same chip, same five tones as the board drawer the
            reviewer just came from. */}
        <StatusChip tone={pipelineStageTone(entry.stage)} label={enumLabel("stage", entry.stage)} />
      </p>
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
