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
  // text color (a "live" signal echoing the pipeline's live indicators).
  //
  // Accessible name, deliberately per-variant. This used to be a blanket
  // `aria-label` on the bare <span>: a span maps to role="generic", for which ARIA
  // PROHIBITS aria-label, so assistive tech is not required to expose it — and the
  // token mappers below lean on labels far richer than the visible text ("Repo-signal
  // review status: no owned public repositories to review"). So:
  //   • richer ariaLabel supplied → role="img" + aria-label. img takes a name, and
  //     it makes the badge one atomic object, replacing the terse visible text with
  //     the full description instead of announcing both.
  //   • no ariaLabel → NO role and NO label. The visible text is already the
  //     accessible content; naming it would only duplicate it.
  // Not role="status": that is an implicit live region, and these badges render
  // statically in lists, which would fire spurious announcements on every paint.
  const named = !!ariaLabel && ariaLabel !== label;
  return (
    <span
      role={named ? "img" : undefined}
      aria-label={named ? ariaLabel : undefined}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-semibold ${
        muted ? "bg-stone-100 text-stone-400" : TONE_CLASS[tone]
      } ${className}`}
    >
      {dot ? (
        // Matches Skeleton's gate; globals.css also stops every .animate-pulse
        // under reduced motion, this keeps the intent readable at the call site.
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" aria-hidden />
      ) : Icon ? (
        <Icon className="h-3 w-3" aria-hidden />
      ) : null}
      <span>{label}</span>
    </span>
  );
}

// ---- Token mappers: enum/string -> semantic badge content -------------------

/** Localized low/medium/high confidence vocabulary, resolved by the CONSUMING
 *  component (e.g. `report.confidence.*`) and passed in — same locale-dumb
 *  doctrine as {@link ConfidenceBandCopy}/{@link FitTierLabels}. Omit to fall
 *  back to the English labels below (additive, non-breaking). */
export type ConfidenceLabels = Partial<Record<"high" | "medium" | "low" | "unknown", string>>;

/** low / medium / high confidence (SalaryEstimate, MarketEvidence). */
export function confidenceToken(value: string, labels?: ConfidenceLabels): BadgeContent {
  const v = (value || "").trim().toLowerCase();
  if (v === "high") return { tone: "positive", icon: ShieldCheck, label: labels?.high ?? "High confidence" };
  if (v === "medium" || v === "moderate") return { tone: "info", icon: CircleDot, label: labels?.medium ?? "Medium confidence" };
  if (v === "low") return { tone: "caution", icon: AlertTriangle, label: labels?.low ?? "Low confidence" };
  return { tone: "neutral", icon: CircleDot, label: labels?.unknown ?? `${value || "Unknown"} confidence` };
}

/** Localized confidence-band vocabulary, resolved by the CONSUMING component from
 *  the `match.band.*` catalog and passed in — the shared Badge primitive stays
 *  locale-dumb (repo doctrine), so the same band renders in the recruiter's
 *  language on every match surface without the primitive importing next-intl.
 *  See `useConfidenceBandCopy` in sub_match/MatchShared. */
export type ConfidenceBandCopy = {
  tight: { label: string; ariaLabel: string };
  moderate: { label: string; ariaLabel: string };
  wide: { label: string; ariaLabel: string };
  /** Tooltip prefix (before the driver bullets) and the tight-band fallback line. */
  title: { prefix: string; fallback: string };
};

/** Match confidence-band width: tight | moderate | wide (MatchResult.confidence.level).
 *  Note the inverse of {@link confidenceToken}'s prose scale — a *tight* band means
 *  *high* certainty (narrow score range), a *wide* band means low certainty. The
 *  visible + aria vocabulary is supplied localized by the caller (ConfidenceBandCopy). */
export function confidenceBandToken(level: string, copy: ConfidenceBandCopy): BadgeContent {
  const v = (level || "").trim().toLowerCase();
  if (v === "tight") return { tone: "positive", icon: ShieldCheck, label: copy.tight.label, ariaLabel: copy.tight.ariaLabel };
  if (v === "wide") return { tone: "caution", icon: AlertTriangle, label: copy.wide.label, ariaLabel: copy.wide.ariaLabel };
  return { tone: "info", icon: CircleDot, label: copy.moderate.label, ariaLabel: copy.moderate.ariaLabel };
}

/** Tooltip text spelling out why a confidence band is as wide as it is — the
 *  drivers the scorer used to discard. Reused by the badge and the raw range. The
 *  prefix + fallback sentence are supplied localized by the caller. */
export function confidenceBandTitle(drivers: string[] = [], copy: ConfidenceBandCopy["title"]): string {
  return drivers.length
    ? `${copy.prefix}\n• ${drivers.join("\n• ")}`
    : copy.fallback;
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

/** Localized interview-prep-provenance vocabulary, resolved by the CONSUMING
 *  component (`scheduleTab.prep.*`) and passed in — same locale-dumb doctrine as
 *  {@link ConfidenceBandCopy}. Omit to fall back to the English copy below. */
export type PrepSourceCopy = {
  fallback: { label: string; ariaLabel: string };
  ai: { label: string; ariaLabel: string };
};

/** Interview-prep generation provenance: an LLM-tailored plan vs the deterministic
 *  template fallback. The fallback carries generic questions and should be
 *  regenerated once the model is reachable, so it reads as a caution, not a
 *  positive — a degraded plan must never look identical to a real AI-tailored one. */
export function prepSourceToken(source?: string | null, copy?: PrepSourceCopy): BadgeContent {
  if (isPrepFallback(source)) {
    return {
      tone: "caution",
      icon: FileText,
      label: copy?.fallback.label ?? "Template fallback",
      ariaLabel: copy?.fallback.ariaLabel ?? "Interview prep generated from a deterministic template — the AI model was unavailable",
    };
  }
  return {
    tone: "info",
    icon: Sparkles,
    label: copy?.ai.label ?? "Generated by AI",
    ariaLabel: copy?.ai.ariaLabel ?? "Interview prep generated by AI, tailored from the candidate's CV",
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

/** Localized fit-tier vocabulary, supplied by the consuming component from the
 *  `match.fitTier.*` catalog. Optional: a surface not yet localized (or an
 *  off-surface caller) falls back to the English FIT_TIER labels, so this stays
 *  additive and non-breaking. See `useFitTierLabels` in sub_match/MatchShared. */
export type FitTierLabels = Partial<Record<FitTier | "unknown", string>>;

export function fitTierToken(tier?: string | null, labels?: FitTierLabels): BadgeContent {
  const key = (tier ?? "").trim().toLowerCase();
  const base = FIT_TIER[key as FitTier];
  if (base) return labels?.[key as FitTier] ? { ...base, label: labels[key as FitTier] as string } : base;
  return { tone: "neutral", icon: CircleDot, label: labels?.unknown ?? "Fit" };
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

export function ConfidenceBadge({ value, labels, className }: { value: string; labels?: ConfidenceLabels; className?: string }) {
  return <Badge {...confidenceToken(value, labels)} className={className} />;
}

export function CodeReviewStatusBadge({ status, className }: { status: string; className?: string }) {
  return <Badge {...codeReviewStatusToken(status)} className={className} />;
}

/** A confidence-band level badge whose native tooltip lists the drivers behind
 *  the band width (early-career, thin skills, unknown education, …). */
export function ConfidenceBandBadge({
  level,
  drivers = [],
  copy,
  className,
}: {
  level: string;
  drivers?: string[];
  /** Localized band vocabulary from the caller (useConfidenceBandCopy). */
  copy: ConfidenceBandCopy;
  className?: string;
}) {
  return (
    <span title={confidenceBandTitle(drivers, copy.title)} className="inline-flex">
      <Badge {...confidenceBandToken(level, copy)} className={className} />
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
  copy,
  className,
}: {
  low: number;
  high: number;
  drivers?: string[];
  /** Localized band vocabulary from the caller (useConfidenceBandCopy); only the
   *  tooltip prefix + fallback are used here. */
  copy: ConfidenceBandCopy;
  className?: string;
}) {
  return (
    <span className={className} title={confidenceBandTitle(drivers, copy.title)}>
      {low}–{high}
    </span>
  );
}

export function ProvenanceBadge({ value, className }: { value: string; className?: string }) {
  return <Badge {...provenanceToken(value)} className={className} />;
}

/** "Generated by AI" / "Template fallback" chip for an interview-prep artifact. */
export function PrepSourceBadge({ source, copy, className }: { source?: string | null; copy?: PrepSourceCopy; className?: string }) {
  return <Badge {...prepSourceToken(source, copy)} className={className} />;
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
  labels,
  className,
}: {
  tier?: string | null;
  // null = unscored — resolves to the neutral "no tier" token, never a "weak"
  // tier derived from a fabricated 0.
  score?: number | null;
  /** Localized fit-tier vocabulary from the caller (useFitTierLabels); omit to
   *  fall back to the English FIT_TIER labels. */
  labels?: FitTierLabels;
  className?: string;
}) {
  const resolved = tier ?? (score != null ? scoreToFitTier(score) : null);
  return <Badge {...fitTierToken(resolved, labels)} className={className} />;
}
