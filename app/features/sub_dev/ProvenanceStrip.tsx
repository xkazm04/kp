import { sourceLabel } from "./DevHelpers";
import type { PerStepSources } from "./DevTypes";

// Human labels for each pipeline step key the CLI envelope can carry. Unknown
// keys fall back to a capitalised form, so a new step renders sensibly before
// this map is updated.
const STEP_LABELS: Record<string, string> = {
  analyze: "Analyze",
  source: "Source",
  role: "Role",
  case: "Case",
  reflect: "Reflect",
  tooling: "Tooling",
  evaluate: "Evaluate",
  transfer: "Transfer",
};

const stepLabel = (key: string): string => STEP_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);

// One visual language for "where did this come from", shared by every step chip
// and the single-source fallback: moss = real LLM, muted stone = template
// fallback, amber = a degraded/mixed run.
function sourceStyle(source?: string): { dot: string; text: string } {
  if (source === "llm") return { dot: "bg-moss", text: "text-ink" };
  if (source === "partial") return { dot: "bg-amber-400", text: "text-amber-700" };
  return { dot: "bg-stone-300", text: "text-steel" }; // deterministic / template / unknown
}

function Chip({ label, source }: { label: string; source?: string }) {
  const { dot, text } = sourceStyle(source);
  return (
    <span
      title={`${label}: ${sourceLabel(source)}`}
      className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-paper px-1.5 py-0.5 text-micro uppercase tracking-wide"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
      <span className={text}>{label}</span>
    </span>
  );
}

// Renders the uniform per-step provenance carried by every devcase CLI command
// ({step: "llm"|"deterministic"}) as a row of compact chips — one consistent
// strip across analyze, design and evaluate. When `perStepSources` is absent
// (bundles saved before the unified contract), it degrades to a single chip
// summarising the combined `source`.
export function ProvenanceStrip({
  perStepSources,
  source,
  className = "",
}: {
  perStepSources?: PerStepSources;
  source?: string;
  className?: string;
}) {
  const steps = Object.entries(perStepSources ?? {});
  const ariaLabel = steps.length
    ? `Provenance: ${steps.map(([k, v]) => `${stepLabel(k)} via ${sourceLabel(v)}`).join(", ")}`
    : `Provenance: ${sourceLabel(source)}`;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 align-middle ${className}`} aria-label={ariaLabel}>
      {steps.length ? (
        steps.map(([key, src]) => <Chip key={key} label={stepLabel(key)} source={src} />)
      ) : (
        <Chip label={sourceLabel(source)} source={source} />
      )}
    </span>
  );
}
