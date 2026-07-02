import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Cpu,
  FileText,
  Inbox,
  Info,
  MinusCircle,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { labelize } from "@/app/_lib/format";
import { isInterviewRecommendation, type InterviewRecommendation } from "@/app/_lib/interview-recommendation";

// One semantic badge system for every qualitative signal the pipeline emits
// (confidence, code-review status, extractor recommendation, engine provenance),
// so the same concept looks identical on every screen and carries an icon +
// accessible label, not color alone.

export type BadgeTone = "positive" | "caution" | "critical" | "neutral" | "info";

const TONE_CLASS: Record<BadgeTone, string> = {
  positive: "bg-moss/15 text-moss",
  caution: "bg-amber-100 text-amber-700",
  critical: "bg-red-50 text-red-700",
  neutral: "bg-stone-100 text-steel",
  info: "bg-blue-50 text-blue-700",
};

export type BadgeContent = {
  tone: BadgeTone;
  icon?: LucideIcon;
  label: string;
  /** Fuller description for assistive tech when the visible label is terse. */
  ariaLabel?: string;
};

export function Badge({
  tone,
  icon: Icon,
  label,
  ariaLabel,
  muted = false,
  dot = false,
  className = "",
}: BadgeContent & { muted?: boolean; dot?: boolean; className?: string }) {
  // `muted` recedes the badge to a neutral stone tint (icon follows currentColor),
  // for "zero / nothing here" counts that should not compete with what changed.
  // `dot` swaps the icon for a small pulsing status dot that inherits the tone's
  // text color (a "live" signal echoing the Radio pulse used across the pipeline).
  return (
    <span
      aria-label={ariaLabel ?? label}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-semibold ${
        muted ? "bg-stone-100 text-stone-400" : TONE_CLASS[tone]
      } ${className}`}
    >
      {dot ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />
      ) : Icon ? (
        <Icon className="h-3 w-3" aria-hidden />
      ) : null}
      <span>{label}</span>
    </span>
  );
}

// ---- Token mappers: enum/string -> semantic badge content -------------------

/** low / medium / high confidence (SalaryEstimate, MarketEvidence). */
export function confidenceToken(value: string): BadgeContent {
  const v = (value || "").trim().toLowerCase();
  if (v === "high") return { tone: "positive", icon: ShieldCheck, label: "High confidence" };
  if (v === "medium" || v === "moderate") return { tone: "info", icon: CircleDot, label: "Medium confidence" };
  if (v === "low") return { tone: "caution", icon: AlertTriangle, label: "Low confidence" };
  return { tone: "neutral", icon: CircleDot, label: `${value || "Unknown"} confidence` };
}

/** Match confidence-band width: tight | moderate | wide (MatchResult.confidence.level).
 *  Note the inverse of {@link confidenceToken}'s prose scale — a *tight* band means
 *  *high* certainty (narrow score range), a *wide* band means low certainty. */
export function confidenceBandToken(level: string): BadgeContent {
  const v = (level || "").trim().toLowerCase();
  if (v === "tight") return { tone: "positive", icon: ShieldCheck, label: "Tight band", ariaLabel: "Confidence band: tight — high certainty" };
  if (v === "wide") return { tone: "caution", icon: AlertTriangle, label: "Wide band", ariaLabel: "Confidence band: wide — low certainty" };
  return { tone: "info", icon: CircleDot, label: "Moderate band", ariaLabel: "Confidence band: moderate certainty" };
}

/** Tooltip text spelling out why a confidence band is as wide as it is — the
 *  drivers the scorer used to discard. Reused by the badge and the raw range. */
export function confidenceBandTitle(drivers: string[] = []): string {
  return drivers.length
    ? `Why this band:\n• ${drivers.join("\n• ")}`
    : "Narrow band — strong, verifiable evidence.";
}

/** repo-signal review status: ok / empty / error / disabled (GithubAnalysis.codeReview).
 *  Four distinct states so an empty review (nothing to review) is never mistaken
 *  for a positive, evidenced-skills result — they differ in color, icon and label. */
export function codeReviewStatusToken(status: string): BadgeContent {
  if (status === "ok") return { tone: "positive", icon: CheckCircle2, label: "Reviewed", ariaLabel: "Repo-signal review status: reviewed" };
  if (status === "empty") return { tone: "info", icon: Inbox, label: "Nothing to review", ariaLabel: "Repo-signal review status: no owned public repositories to review" };
  if (status === "error") return { tone: "critical", icon: XCircle, label: "Error", ariaLabel: "Repo-signal review status: error" };
  return { tone: "neutral", icon: MinusCircle, label: "Disabled", ariaLabel: "Repo-signal review status: disabled" };
}

/** Whether an interview-prep artifact came from the deterministic TEMPLATE
 *  fallback (generic questions, used when the LLM was unavailable) rather than the
 *  AI path. Anything other than the explicit "llm" source is treated as degraded,
 *  so a new/unknown state never silently passes as AI-tailored. */
export function isPrepFallback(source?: string | null): boolean {
  return (source || "").trim().toLowerCase() !== "llm";
}

/** Interview-prep generation provenance: an LLM-tailored plan vs the deterministic
 *  template fallback. The fallback carries generic questions and should be
 *  regenerated once the model is reachable, so it reads as a caution, not a
 *  positive — a degraded plan must never look identical to a real AI-tailored one. */
export function prepSourceToken(source?: string | null): BadgeContent {
  if (isPrepFallback(source)) {
    return {
      tone: "caution",
      icon: FileText,
      label: "Template fallback",
      ariaLabel: "Interview prep generated from a deterministic template — the AI model was unavailable",
    };
  }
  return {
    tone: "info",
    icon: Sparkles,
    label: "Generated by AI",
    ariaLabel: "Interview prep generated by AI, tailored from the candidate's CV",
  };
}

/** Engine / extractor provenance (e.g. "gemini", "pypdf", "template"). */
export function provenanceToken(value: string): BadgeContent {
  const v = (value || "").trim().toLowerCase();
  const llmBacked = v.includes("gemini") || v.includes("llm") || v.includes("claude");
  return {
    tone: llmBacked ? "info" : "neutral",
    icon: Cpu,
    label: labelize(value || "unknown"),
    ariaLabel: `Source: ${value || "unknown"}`,
  };
}

// Per-verdict badge content for the canonical advance/hold/reject set. Keyed by
// the InterviewRecommendation union so adding/removing a verdict in the contract
// (app/_lib/interview-recommendation.ts) is a compile error here until handled.
const INTERVIEW_REC_BADGE: Record<InterviewRecommendation, BadgeContent> = {
  advance: { tone: "positive", icon: CheckCircle2, label: "Advance", ariaLabel: "Interview recommendation: advance" },
  hold: { tone: "caution", icon: MinusCircle, label: "Hold", ariaLabel: "Interview recommendation: hold" },
  reject: { tone: "critical", icon: XCircle, label: "Reject", ariaLabel: "Interview recommendation: reject" },
};

/** Interview scorecard verdict: advance / hold / reject (Scorecard.recommendation).
 *  Accepts a raw string on purpose: an unknown / off-taxonomy verdict (model
 *  drift) renders the RAW value in a neutral badge rather than silently masking
 *  it as "hold" — the render boundary surfaces drift so a human notices, whereas
 *  LOGIC boundaries coerce to the safe fallback via coerceInterviewRecommendation. */
export function interviewRecommendationToken(rec: string): BadgeContent {
  if (isInterviewRecommendation(rec)) return INTERVIEW_REC_BADGE[rec.trim().toLowerCase() as InterviewRecommendation];
  return { tone: "neutral", icon: CircleDot, label: labelize(rec || "unknown"), ariaLabel: `Interview recommendation: ${rec || "unknown"}` };
}

export type FitTier = "strong" | "promising" | "partial";

// Candidate <-> job match banding. Mirrors the server's single source of truth in
// pipeline/jobfit/matching.py (fit_tier_for + _FIT_TONE: strong->positive,
// promising->info, partial->caution), so a MatchResult.fitTier and a bare numeric
// score both resolve to the same color, label, and icon on every match surface.
const FIT_TIER: Record<FitTier, BadgeContent> = {
  strong: { tone: "positive", icon: CheckCircle2, label: "Strong fit" },
  promising: { tone: "info", icon: CircleDot, label: "Promising fit" },
  partial: { tone: "caution", icon: MinusCircle, label: "Partial fit" },
};

export function fitTierToken(tier?: string | null): BadgeContent {
  const key = (tier ?? "").trim().toLowerCase();
  return FIT_TIER[key as FitTier] ?? { tone: "neutral", icon: CircleDot, label: "Fit" };
}

// Threshold fallback for surfaces that hold only a numeric match score (e.g. the
// pipeline's stored matchScore in the simulation) and no server-emitted fitTier.
// Kept in lockstep with matching.py (FIT_STRONG_THRESHOLD 70 / FIT_PROMISING 55).
export function scoreToFitTier(score: number): FitTier {
  if (score >= 70) return "strong";
  if (score >= 55) return "promising";
  return "partial";
}

/** ExtractionQuality.recommendation prose -> a compact, tone-coded summary. */
export function recommendationToken(text: string): BadgeContent {
  const t = (text || "").toLowerCase();
  if (t.includes("prefer gemini") || t.includes("gemini extraction")) {
    return { tone: "caution", icon: AlertTriangle, label: "Use Gemini", ariaLabel: "Recommendation: prefer Gemini extraction" };
  }
  if (t.includes("sufficient")) {
    return { tone: "positive", icon: CheckCircle2, label: "pypdf OK", ariaLabel: "Recommendation: pypdf extraction is sufficient" };
  }
  return { tone: "neutral", icon: Info, label: "Review", ariaLabel: "Recommendation: review profile evidence" };
}

// ---- Convenience wrappers for the common call sites ------------------------

export function ConfidenceBadge({ value, className }: { value: string; className?: string }) {
  return <Badge {...confidenceToken(value)} className={className} />;
}

export function CodeReviewStatusBadge({ status, className }: { status: string; className?: string }) {
  return <Badge {...codeReviewStatusToken(status)} className={className} />;
}

/** A confidence-band level badge whose native tooltip lists the drivers behind
 *  the band width (early-career, thin skills, unknown education, …). */
export function ConfidenceBandBadge({
  level,
  drivers = [],
  className,
}: {
  level: string;
  drivers?: string[];
  className?: string;
}) {
  return (
    <span title={confidenceBandTitle(drivers)} className="inline-flex">
      <Badge {...confidenceBandToken(level)} className={className} />
    </span>
  );
}

/** The titled `low–high` confidence-range text — the numeric band whose native
 *  tooltip re-reads the same drivers as ConfidenceBandBadge. Shared by every match
 *  surface so the band rendering (and its drivers tooltip) lives in one place
 *  instead of being hand-rolled beside each badge. `className` carries the
 *  per-surface text styling (e.g. text-sm vs nums). */
export function ConfidenceRange({
  low,
  high,
  drivers = [],
  className,
}: {
  low: number;
  high: number;
  drivers?: string[];
  className?: string;
}) {
  return (
    <span className={className} title={confidenceBandTitle(drivers)}>
      {low}–{high}
    </span>
  );
}

export function ProvenanceBadge({ value, className }: { value: string; className?: string }) {
  return <Badge {...provenanceToken(value)} className={className} />;
}

/** "Generated by AI" / "Template fallback" chip for an interview-prep artifact. */
export function PrepSourceBadge({ source, className }: { source?: string | null; className?: string }) {
  return <Badge {...prepSourceToken(source)} className={className} />;
}

export function RecommendationBadge({ text, className }: { text: string; className?: string }) {
  return <Badge {...recommendationToken(text)} className={className} />;
}

export function InterviewRecommendationBadge({ rec, className }: { rec: string; className?: string }) {
  return <Badge {...interviewRecommendationToken(rec)} className={className} />;
}

// Pass `tier` when the surface has a server-computed MatchResult.fitTier; pass
// `score` for surfaces holding only the numeric match score (the tier is derived).
export function FitTierBadge({
  tier,
  score,
  className,
}: {
  tier?: string | null;
  // null = unscored — resolves to the neutral "no tier" token, never a "weak"
  // tier derived from a fabricated 0.
  score?: number | null;
  className?: string;
}) {
  const resolved = tier ?? (score != null ? scoreToFitTier(score) : null);
  return <Badge {...fitTierToken(resolved)} className={className} />;
}
