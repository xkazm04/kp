"use client";

// Quality BASELINE — the section exactly as it renders today: calibration, then
// the sealed decision records, then the paged decision log, each in its own
// panel with its own fetch.
//
// The A/B control for this prototype round.
import { Defer } from "@/app/_components/ui/Defer";
import { CalibrationPanel, DecisionRecordsPanel, DecisionLog } from "./sectionChunks";

export function QualityBaseline() {
  return (
    <div className="animate-arrive-in space-y-6">
      {/* Each of these runs its OWN fetch, independent of the main analytics
          payload — never held on a sibling (loading-choreography law 4). They
          mount an idle beat apart so their charts don't all commit on one frame. */}
      <Defer strategy="idle">
        <CalibrationPanel />
      </Defer>

      <Defer strategy="idle">
        <DecisionRecordsPanel />
      </Defer>

      <Defer strategy="visible">
        <DecisionLog />
      </Defer>
    </div>
  );
}
