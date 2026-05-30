import { Avatar, Legend } from "./PipelineShared";
import { STAGES, type Entry } from "./PipelineTypes";

type Position = { id: string; title: string; family: string; count: number };

export function PipelineBoard({
  positions,
  entries,
  isStale,
  openPositionRanking,
  openCandidate,
}: {
  positions: Position[];
  entries: Entry[];
  isStale: (e: Entry) => boolean;
  openPositionRanking: (jobId: string) => void;
  openCandidate: (e: Entry) => void;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-meta uppercase tracking-wide text-steel">Positions</h3>
      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-panel">
        <div className="min-w-[860px]">
          <div className="grid grid-cols-[180px_repeat(6,1fr)] border-b border-stone-200 bg-paper">
            <div className="px-3 py-2 text-meta uppercase text-steel">Position</div>
            {STAGES.map((s) => (
              <div key={s} className="px-3 py-2 text-center text-meta uppercase text-steel">
                {s}
              </div>
            ))}
          </div>
          {positions.map((pos) => {
            const lane = entries.filter((e) => (e.jobId ?? e.jobTitle) === pos.id);
            return (
              <div key={pos.id} className="grid grid-cols-[180px_repeat(6,1fr)] border-b border-stone-100 last:border-0">
                <div className="border-r border-stone-100 px-3 py-3">
                  <p className="text-sm font-semibold leading-tight text-ink">{pos.title}</p>
                  <p className="text-[11px] text-steel">{pos.count} active</p>
                  <button
                    type="button"
                    onClick={() => openPositionRanking(pos.id)}
                    className="focus-ring mt-1 text-[11px] font-semibold text-coral hover:underline"
                  >
                    Rank candidates →
                  </button>
                </div>
                {STAGES.map((stage) => {
                  const cell = lane.filter((e) => e.stage === stage);
                  return (
                    <div key={stage} className="border-r border-stone-100 px-2 py-3 last:border-0">
                      <div className="flex flex-wrap gap-1">
                        {cell.slice(0, 6).map((e) => (
                          <Avatar
                            key={e.id}
                            entry={e}
                            pending={!!e.approvalKind}
                            stale={isStale(e)}
                            onClick={() => openCandidate(e)}
                          />
                        ))}
                        {cell.length > 6 ? (
                          <span
                            className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-stone-100 px-1.5 text-[11px] font-semibold text-steel"
                            title={cell.slice(6).map((e) => e.candidateLabel).join(", ")}
                          >
                            +{cell.length - 6}
                          </span>
                        ) : null}
                        {cell.length === 0 ? <span className="text-[11px] text-stone-300">·</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <Legend />
    </section>
  );
}
