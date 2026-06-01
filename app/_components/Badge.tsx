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

export function Badge({ tone, icon: Icon, label, ariaLabel, className = "" }: BadgeContent & { className?: string }) {
  return (
    <span
      aria-label={ariaLabel ?? label}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-semibold ${TONE_CLASS[tone]} ${className}`}
    >
      {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
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

export function ProvenanceBadge({ value, className }: { value: string; className?: string }) {
  return <Badge {...provenanceToken(value)} className={className} />;
}

export function RecommendationBadge({ text, className }: { text: string; className?: string }) {
  return <Badge {...recommendationToken(text)} className={className} />;
}
