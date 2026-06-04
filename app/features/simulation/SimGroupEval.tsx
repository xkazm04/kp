"use client";

import { GroupEvalModal } from "@/app/features/sub_decisions/GroupEvalModal";
import { useSimulation } from "./SimulationProvider";

// Surfaces the group-evaluation comparison during the simulation's Offer step,
// reusing the real Decisions modal so the viewer sees the actual field ranking.
export function SimGroupEval() {
  const { groupEval, closeGroupEval } = useSimulation();
  if (!groupEval) return null;
  return (
    <GroupEvalModal
      roleTitle={groupEval.roleTitle}
      evaluation={groupEval.payload}
      loading={groupEval.loading}
      error={groupEval.error}
      onClose={closeGroupEval}
      onRerun={() => undefined}
    />
  );
}
