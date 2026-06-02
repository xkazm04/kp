"use client";

import { useRef, useState } from "react";
import { needsHumanDecision } from "@/app/_lib/approval-kinds";
import { CandidateRow, Legend } from "./PipelineShared";
import { STAGES, type Entry } from "./PipelineTypes";

type Position = { id: string; title: string; family: string; count: number };

const CELL_LIMIT = 6;

// One stage cell. The overflow control is a real focusable button (was a
// title-only <p>) so keyboard/touch users can reveal the hidden candidates,
// which then render as the same navigable CandidateRows.
function StageCell({
  entries,
  isStale,
  openProfile,
  openActions,
}: {
  entries: Entry[];
  isStale: (e: Entry) => boolean;
  openProfile: (e: Entry) => void;
  openActions: (e: Entry) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const overflow = entries.length - CELL_LIMIT;
  const visible = expanded ? entries : entries.slice(0, CELL_LIMIT);
  return (
    <div className="space-y-0.5 border-r border-stone-100 px-1.5 py-2 last:border-0">
      {visible.map((e) => (
        <CandidateRow
          key={e.id}
          entry={e}
          pending={needsHumanDecision(e.approvalKind)}
          stale={isStale(e)}
          onOpen={() => openProfile(e)}
          onActions={() => openActions(e)}
        />
      ))}
      {overflow > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="focus-ring w-full rounded px-1 text-left text-sm font-semibold text-steel hover:text-coral"
        >
          {expanded ? "Show fewer" : `+${overflow} more`}
        </button>
      ) : null}
      {entries.length === 0 ? <span className="px-1 text-sm text-stone-300">·</span> : null}
    </div>
  );
}

export function PipelineBoard({
  positions,
  entries,
  isStale,
  openPositionRanking,
  openProfile,
  openJob,
  openActions,
}: {
  positions: Position[];
  entries: Entry[];
  isStale: (e: Entry) => boolean;
  openPositionRanking: (jobId: string) => void;
  openProfile: (e: Entry) => void;
  openJob: (jobId: string) => void;
  openActions: (e: Entry) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Click a stage header to glide that column to the centre of the viewport, so
  // a wide pipeline is navigable left↔right without dragging the scrollbar.
  const centerColumn = (e: React.MouseEvent<HTMLButtonElement>) => {
    const container = scrollRef.current;
    if (!container) return;
    const cell = e.currentTarget;
    const delta =
      cell.getBoundingClientRect().left -
      container.getBoundingClientRect().left -
      (container.clientWidth - cell.clientWidth) / 2;
    container.scrollBy({ left: delta, behavior: "smooth" });
  };

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-meta uppercase tracking-wide text-steel">Positions</h3>
        <span className="text-sm text-steel">Click a stage header to centre it · scroll horizontally to move across the pipeline</span>
      </div>
      <div ref={scrollRef} className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-panel">
        <div className="min-w-[2240px]">
          <div className="grid grid-cols-[240px_repeat(7,minmax(280px,1fr))] border-b border-stone-200 bg-paper">
            <div className="sticky left-0 z-20 bg-paper px-3 py-2 text-meta uppercase text-steel">Position</div>
            {STAGES.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={centerColumn}
                title={`Centre the ${s} column`}
                className="focus-ring px-3 py-2 text-center text-meta uppercase text-steel hover:bg-stone-100 hover:text-ink"
              >
                <span className="text-stone-400">{i + 1}.</span> {s}
              </button>
            ))}
          </div>
          {positions.map((pos) => {
            const lane = entries.filter((e) => (e.jobId ?? e.jobTitle) === pos.id);
            return (
              <div key={pos.id} className="grid grid-cols-[240px_repeat(7,minmax(280px,1fr))] border-b border-stone-100 last:border-0">
                <div className="sticky left-0 z-10 border-r border-stone-100 bg-white px-3 py-3">
                  <button
                    type="button"
                    onClick={() => openJob(pos.id)}
                    title="Open the job description"
                    className="focus-ring text-left text-base font-semibold leading-tight text-ink hover:text-coral"
                  >
                    {pos.title}
                  </button>
                  <p className="text-sm text-steel">{pos.count} active</p>
                  <button
                    type="button"
                    onClick={() => openPositionRanking(pos.id)}
                    className="focus-ring mt-1 text-sm font-semibold text-coral hover:underline"
                  >
                    Rank candidates →
                  </button>
                </div>
                {STAGES.map((stage) => (
                  <StageCell
                    key={stage}
                    entries={lane.filter((e) => e.stage === stage)}
                    isStale={isStale}
                    openProfile={openProfile}
                    openActions={openActions}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <Legend />
    </section>
  );
}
