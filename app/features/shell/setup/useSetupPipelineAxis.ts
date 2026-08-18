"use client";

// Load the board's real column axis into the wizard's state, once, on mount.
//
// It lives in the HOST, not in the Pipeline step component, for one reason: the
// draft belongs to the shared setup state so an edit survives stepping away and
// back. A fetch inside the step would re-run on every visit and would have to
// guard against overwriting the operator's edits; hoisting it means the step is
// pure presentation over `ctrl.state.pipeline`.
//
// Occupancy is fetched alongside and is ADVISORY: a fresh workspace has zero
// candidates, but the wizard also opens over a populated one (Settings →
// "Preview onboarding", `?onboarding=1`). There, a column with people on it is
// one the server will refuse to drop (409 migration_required, see
// app/api/pipeline/stage-migration/route.ts) — so the step disables that removal
// instead of offering an edit that can only fail at finish. A failed occupancy
// read yields no counts, which is the conservative direction: nothing looks
// safe to remove that we haven't verified.
import { useEffect } from "react";
import { draftFromStored } from "@/app/features/shared/pipelineAxisDraft";
import type { PipelineStagesRule } from "@/app/_lib/decision-config-schema";
import type { SetupState } from "./setupSteps";

type ConfigPayload = { configs?: { pipelineStages?: PipelineStagesRule } };

export function useSetupPipelineAxis(update: (patch: Partial<SetupState>) => void): void {
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [payload, impact] = await Promise.all([
          fetch("/api/decisions/config").then((r) => (r.ok ? (r.json() as Promise<ConfigPayload>) : Promise.reject(new Error()))),
          fetch("/api/pipeline/stage-impact")
            .then((r) => (r.ok ? (r.json() as Promise<{ counts?: Record<string, number> }>) : { counts: {} }))
            .catch(() => ({ counts: {} as Record<string, number> })),
        ]);
        const stored = payload.configs?.pipelineStages;
        if (!stored) throw new Error("no axis");
        if (!alive) return;
        update({
          pipeline: { stored, draft: draftFromStored(stored), counts: impact.counts ?? {} },
          pipelineLoad: "ready",
        });
      } catch {
        // Not a spinner that never ends: the step says the board couldn't be read
        // and lets the operator past — whatever the workspace has stays.
        if (alive) update({ pipelineLoad: "failed" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [update]);
}
