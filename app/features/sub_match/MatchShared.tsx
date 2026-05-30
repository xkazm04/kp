import type { ReasoningState } from "./MatchTypes";

export function ReasoningPanel({ state }: { state: ReasoningState }) {
  if (state.loading) return <p className="mt-3 text-xs text-steel">Generating reasoning…</p>;
  if (state.error) return <p className="mt-3 rounded-md bg-red-50 p-2 text-xs text-red-700">{state.error}</p>;
  if (!state.data) return null;
  const r = state.data;
  return (
    <div className="mt-3 rounded-md border border-stone-200 bg-paper/50 p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-coral">Reasoning</span>
        <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-steel">
          {state.source === "llm" ? "LLM" : "rule-based"}
          {state.cached ? " · cached" : ""}
        </span>
      </div>
      <p className="mt-1 text-sm text-ink">{r.verdict}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <ReasonList title="Strengths" items={r.strengths} tone="green" />
        <ReasonList title="Gaps" items={r.gaps} tone="red" />
        <ReasonList title="Interview probes" items={r.interviewProbes} tone="neutral" />
      </div>
    </div>
  );
}

function ReasonList({ title, items, tone }: { title: string; items: string[]; tone: "green" | "red" | "neutral" }) {
  const dot = tone === "green" ? "text-green-600" : tone === "red" ? "text-red-600" : "text-steel";
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-steel">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-1 text-xs text-ink">
            <span className={dot}>•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  // Fill color tracks the score (coral -> amber -> moss), not just bar length.
  const tone = pct < 45 ? "bg-coral/70" : pct < 72 ? "bg-dial-amber" : "bg-moss";
  return (
    <div>
      <div className="flex justify-between text-[10px] text-steel">
        <span className="uppercase">{label}</span>
        <span>{pct}</span>
      </div>
      <div className="mt-0.5 h-1.5 rounded-full bg-stone-100">
        <div className={`h-1.5 rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Chip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "green" | "amber";
}) {
  const toneClass =
    tone === "green"
      ? "border-green-200 bg-green-50 text-green-800"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-stone-200 bg-paper text-ink";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${toneClass}`}>
      <span className="uppercase tracking-wide text-steel">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}
