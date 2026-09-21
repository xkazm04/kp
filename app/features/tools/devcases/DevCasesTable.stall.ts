// Table-level collecting stall: same SLA as LifecycleRow (`lifecycleStall`), so
// an empty live assignment past seven days is visible on the Cases chase list
// without opening the lifecycle strip.
import { lifecycleStall, type LifecycleStall } from "@/app/_lib/devcase-sla";

export function stallForCase(
  input: { stage: string; updatedAt?: string | null; createdAt: string; submissionCount: number },
  nowMs: number,
): LifecycleStall {
  return lifecycleStall(input, nowMs);
}
