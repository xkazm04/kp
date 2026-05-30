import { APPLIED_LABEL, type Result } from "./CandidateDrawerTypes";

function SourceBadge({ source }: { source: string }) {
  const llm = source === "llm";
  return (
    <span className={`rounded-full px-2 py-0.5 text-sm font-semibold uppercase ${llm ? "bg-coral/15 text-coral" : "bg-stone-200 text-steel"}`}>
      {llm ? "Claude CLI" : "template"}
    </span>
  );
}

export function ResultView({ result }: { result: Result }) {
  const d = result.data as Record<string, unknown>;
  const applied = APPLIED_LABEL[result.applied];
  return (
    <div className="animate-fade-in rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-wide text-steel">{result.task}</p>
        <SourceBadge source={result.source} />
      </div>

      {(result.task === "outreach" || result.task === "rejection") && (
        <div className="space-y-1.5">
          <p className="text-base font-semibold text-ink">{String(d.subject ?? "")}</p>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">{String(d.body ?? "")}</pre>
          {d.feedback ? <p className="text-sm text-steel">Feedback: {String(d.feedback)}</p> : null}
          <p className="text-sm uppercase text-steel">{String(d.language ?? "")}</p>
        </div>
      )}

      {result.task === "screen" && (
        <div className="space-y-1.5 text-sm text-ink">
          <p>
            <span className="font-semibold uppercase">{String(d.recommendation ?? "")}</span>
            {typeof d.confidence === "number" ? ` · ${d.confidence}% confidence` : ""}
          </p>
          <p>{String(d.rationale ?? "")}</p>
        </div>
      )}

      {result.task === "prep" && (
        <ol className="list-decimal space-y-2 pl-4 text-sm text-ink">
          {((d.questions as { competency?: string; question?: string; whatsGoodLooksLike?: string }[]) ?? []).map((q, i) => (
            <li key={i}>
              <span className="font-semibold">{q.question}</span>
              {q.whatsGoodLooksLike ? <span className="block text-sm text-steel">Good answer: {q.whatsGoodLooksLike}</span> : null}
            </li>
          ))}
        </ol>
      )}

      {result.task === "scorecard" && (
        <div className="space-y-1.5 text-sm text-ink">
          <p className="font-semibold uppercase">{String(d.recommendation ?? "")}</p>
          {d.summary ? <p>{String(d.summary)}</p> : null}
          <ul className="space-y-0.5">
            {((d.ratings as { competency: string; rating: number }[]) ?? []).map((r, i) => (
              <li key={i} className="flex justify-between">
                <span className="text-steel">{r.competency}</span>
                <span className="font-semibold">{r.rating}/5</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.task === "offer" && (
        <div className="space-y-2 text-sm text-ink">
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-2xl text-ink">{Number(d.recommended ?? 0).toLocaleString()}</span>
            <span className="text-steel">{String(d.currency ?? "CZK")} / mo</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-stone-200">
            <div
              className="h-full rounded-full bg-moss"
              style={{
                width: `${Math.max(4, Math.min(100, ((Number(d.recommended) - Number(d.salaryMin)) / Math.max(1, Number(d.salaryMax) - Number(d.salaryMin))) * 100))}%`,
              }}
            />
          </div>
          <p className="text-sm text-steel">
            band {Number(d.salaryMin ?? 0).toLocaleString()}–{Number(d.salaryMax ?? 0).toLocaleString()} {String(d.currency ?? "")}
          </p>
          <p className="text-steel">{String(d.rationale ?? "")}</p>
          <p className="mt-1 font-semibold text-ink">{String(d.subject ?? "")}</p>
          <pre className="whitespace-pre-wrap font-sans leading-relaxed text-ink">{String(d.body ?? "")}</pre>
        </div>
      )}

      {result.task === "rematch" && (
        <div className="space-y-1 text-sm text-ink">
          {d.found ? (
            <>
              <p className="font-semibold">
                {String(d.jobTitle ?? "")} <span className="text-moss">· {String(d.score ?? "")} match</span>
              </p>
              <p className="text-steel">{String(d.rationale ?? "")}</p>
            </>
          ) : (
            <p className="text-steel">{String(d.reason ?? "No alternative found.")}</p>
          )}
        </div>
      )}

      {applied ? <p className="mt-2 rounded bg-moss/10 px-2 py-1 text-sm font-semibold text-moss">{applied}</p> : null}
    </div>
  );
}
