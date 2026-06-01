"use client";

import { useState } from "react";
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
  return (
    <section className="space-y-3">
      <h3 className="text-meta uppercase tracking-wide text-steel">Positions</h3>
      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-panel">
        <div className="min-w-[1200px]">
          <div className="grid grid-cols-[200px_repeat(7,minmax(0,1fr))] border-b border-stone-200 bg-paper">
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
              <div key={pos.id} className="grid grid-cols-[200px_repeat(7,minmax(0,1fr))] border-b border-stone-100 last:border-0">
                <div className="border-r border-stone-100 px-3 py-3">
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
