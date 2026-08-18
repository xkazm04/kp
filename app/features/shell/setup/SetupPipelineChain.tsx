"use client";

// A funnel, read left to right: the columns as chips with arrows between them.
//
// The one piece the Pipeline step's preset tiles and the hand-off summary both
// need, hoisted the moment the second surface wanted it (the /prototype rule).
// Read-only by design — every edit affordance lives in the step itself, so this
// stays safe to drop anywhere a board shape needs to be SHOWN.
import { ChevronRight } from "lucide-react";
import type { StageDef } from "@/app/_lib/pipeline-stages";

export function SetupPipelineChain({
  stages,
  /** Columns this shape ADDS, drawn in the accent so the difference is visible. */
  addedIds,
  className,
}: {
  stages: readonly Pick<StageDef, "id" | "label">[];
  addedIds?: readonly string[];
  className?: string;
}) {
  const added = new Set(addedIds ?? []);
  return (
    <ol className={`flex flex-wrap items-center gap-x-1 gap-y-1.5 ${className ?? ""}`}>
      {stages.map((stage, i) => (
        <li key={stage.id} className="flex items-center gap-1">
          <span
            className={`rounded-full px-2 py-0.5 text-sm ${
              added.has(stage.id) ? "bg-coral/10 font-semibold text-coral" : "bg-stone-100 text-steel"
            }`}
          >
            {stage.label}
          </span>
          {i < stages.length - 1 ? <ChevronRight size={13} aria-hidden className="shrink-0 text-stone-400" /> : null}
        </li>
      ))}
    </ol>
  );
}
