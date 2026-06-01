import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Cpu,
  Info,
  MinusCircle,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { labelize } from "@/app/_lib/format";

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

/** code-review status: ok / error / disabled (GithubAnalysis.codeReview). */
export function codeReviewStatusToken(status: string): BadgeContent {
  if (status === "ok") return { tone: "positive", icon: CheckCircle2, label: "Reviewed", ariaLabel: "Code review status: reviewed" };
  if (status === "error") return { tone: "critical", icon: XCircle, label: "Error", ariaLabel: "Code review status: error" };
  return { tone: "neutral", icon: MinusCircle, label: "Disabled", ariaLabel: "Code review status: disabled" };
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

/** Interview scorecard verdict: advance / hold / reject (Scorecard.recommendation). */
export function interviewRecommendationToken(rec: string): BadgeContent {
  const v = (rec || "").trim().toLowerCase();
  if (v === "advance") return { tone: "positive", icon: CheckCircle2, label: "Advance", ariaLabel: "Interview recommendation: advance" };
  if (v === "reject") return { tone: "critical", icon: XCircle, label: "Reject", ariaLabel: "Interview recommendation: reject" };
  if (v === "hold") return { tone: "caution", icon: MinusCircle, label: "Hold", ariaLabel: "Interview recommendation: hold" };
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

export function ProvenanceBadge({ value, className }: { value: string; className?: string }) {
  return <Badge {...provenanceToken(value)} className={className} />;
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
  score?: number;
  className?: string;
}) {
  const resolved = tier ?? (score != null ? scoreToFitTier(score) : null);
  return <Badge {...fitTierToken(resolved)} className={className} />;
}
