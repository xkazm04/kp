import { describeSource } from "./DevHelpers";
import type { PerStepSources, SourceKind } from "./DevTypes";

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

function Chip({ label, source }: { label: string; source?: SourceKind }) {
  // One visual language for "where did this come from", from the shared descriptor:
  // moss = real LLM, amber = degraded/mixed, muted stone = template/deterministic.
  const { dotClass, textClass, label: sourceText } = describeSource(source);
  return (
    <span
      title={`${label}: ${sourceText}`}
      className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-paper px-1.5 py-0.5 text-micro uppercase tracking-wide"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden />
      <span className={textClass}>{label}</span>
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
  source?: SourceKind;
  className?: string;
}) {
  const steps = Object.entries(perStepSources ?? {});
  const ariaLabel = steps.length
    ? `Provenance: ${steps.map(([k, v]) => `${stepLabel(k)} via ${describeSource(v).label}`).join(", ")}`
    : `Provenance: ${describeSource(source).label}`;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 align-middle ${className}`} aria-label={ariaLabel}>
      {steps.length ? (
        steps.map(([key, src]) => <Chip key={key} label={stepLabel(key)} source={src} />)
      ) : (
        <Chip label={describeSource(source).label} source={source} />
      )}
    </span>
  );
}
