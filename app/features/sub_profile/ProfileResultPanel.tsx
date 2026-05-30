import { Meter } from "@/app/_components/Meter";
import type { BuildResult } from "./ProfileTypes";
import { ARCHETYPE_LABEL } from "./ProfileTypes";

export function ResultPanel({ result }: { result: BuildResult }) {
  const pct = Math.round((result.completeness ?? 0) * 100);
  return (
    <div className="mt-4 rounded-lg border border-stone-200 bg-paper/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-ink px-2.5 py-0.5 text-sm font-semibold text-white">
          {ARCHETYPE_LABEL[result.archetype] ?? result.archetype}
        </span>
        <span className="text-sm text-steel">confidence {Math.round((result.confidence ?? 0) * 100)}%</span>
        {result.saved?.id ? (
          <span className="ml-auto text-sm text-green-700">saved · {result.saved.id}</span>
        ) : (
          <span className="ml-auto text-sm text-steel">preview (not saved)</span>
        )}
      </div>
      {result.reasons?.length ? (
        <p className="mt-1 text-sm text-steel">Routing: {result.reasons.join("; ")}</p>
      ) : null}

      <div className="mt-3">
        <div className="flex justify-between text-sm text-steel">
          <span className="font-semibold uppercase tracking-wide">Completeness</span>
          <span>{pct}%</span>
        </div>
        <Meter value={pct} tone={pct >= 70 ? "moss" : "coral"} className="mt-1 h-2" aria-label={`Profile completeness ${pct}%`} />
      </div>
      {result.missing?.length ? (
        <div className="mt-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-steel">Add next</p>
          <ul className="mt-1 list-disc pl-4 text-sm text-ink">
            {result.missing.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-sm text-green-700">Profile looks complete for its archetype.</p>
      )}
    </div>
  );
}
