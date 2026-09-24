import { NextResponse } from "next/server";
import { safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { readGigKpiInput } from "@/app/_lib/db/gigs-outcomes";
import { foldGigKpi } from "@/app/_lib/gigs/kpi";

// GET /api/gigs/kpi -> GigKpi: accepted/resolved per arena and per specialist, pending
// shown beside (never folded into) the rate, cost per accepted outcome from the metered
// spend Personas reported (with the count of attempts it never reported), and the
// disclosure rate over sent work. The fold is pure (gigs/kpi.ts); the store only gathers
// this workspace's rows (db/gigs-outcomes.ts readGigKpiInput). A rate is null - never
// 0% - while nothing has resolved, and flagged small-sample under 10 resolved.

export async function GET(): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    return NextResponse.json(foldGigKpi(readGigKpiInput(await currentWorkspace())));
  } catch (error) {
    return safeJsonError(error, "api:gigs/kpi", "GIG_STORE_FAILED");
  }
}
