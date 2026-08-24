"use client";

// Read what this machine already holds for Candi into the wizard's state, once,
// on mount — the same shape and the same reasoning as useSetupPipelineAxis.
//
// It lives in the HOST rather than in the step for the usual reason (a fetch
// inside the step re-runs on every visit and would have to guard against
// clobbering the operator's answer), and for one specific to this step: the
// probe SPAWNS PYTHON, so re-running it every time somebody steps back is a
// process per visit for an answer that cannot have changed.
//
// It runs in BOTH modes. GET /api/companion/brain creates nothing — that is the
// whole point of the probe door — so the Settings walkthrough shows this
// machine's real state instead of a made-up one, exactly as the axis read does.
// Writing is what preview must not do, and preview's finish() persists nothing.
//
// A failed probe is a real state, not a spinner that never ends: the step says
// it could not look and lets the operator past. Nothing is lost by that — the
// consent question can be answered later, and the conservative default (no
// consent recorded, memory off) is the one that touches nothing.
import { useEffect } from "react";
import { coerceBrainStatus } from "@/app/_lib/companion-brain-probe";
import type { SetupState } from "./setupSteps";

export function useSetupCompanionBrain(update: (patch: Partial<SetupState>) => void): void {
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/companion/brain");
        if (!res.ok) throw new Error("probe failed");
        const status = coerceBrainStatus(await res.json());
        if (!alive) return;
        update({ brain: status, brainLoad: "ready" });
      } catch {
        if (alive) update({ brainLoad: "failed" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [update]);
}
