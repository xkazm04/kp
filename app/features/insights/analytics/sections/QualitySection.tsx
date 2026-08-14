"use client";

// Analytics → Quality & audit: "can I trust the scoring, and can I prove what we
// decided".
//
// The compliance half of the tab, which used to be its unreachable tail — the
// calibration panel, the decision records and the full decision log all sat
// below several screens of charts, so the surface that exists to be AUDITED was
// the one nobody scrolled to. Given its own section it opens in one click and
// its panels get the whole viewport.
import { Defer } from "@/app/_components/ui/Defer";
import { CalibrationPanel, DecisionRecordsPanel, DecisionLog } from "./sectionChunks";

export function QualitySection() {
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
