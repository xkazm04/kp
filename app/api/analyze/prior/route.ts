import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";
import { requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { listPriorRunsByCvHashes } from "@/app/_lib/db/analyses-prior";
import { priorRunQuery } from "@/app/features/tools/analyze/analyzePriorRuns";

/**
 * GET /api/analyze/prior?cv=<hash>[&cv=...]&jd=<slug>
 * Inspects whether any of the supplied CV content hashes have prior runs in the current workspace.
 * Gated by requireOperator and requireCapabilityCoded("read").
 */
export const GET = withWorkspace(async (ws: string, request: NextRequest) => {
  const opDenied = await requireOperator();
  if (opDenied) return opDenied;

  const capDenied = await requireCapabilityCoded("read", requireCapability);
  if (capDenied) return capDenied;

  try {
    const { searchParams } = new URL(request.url);
    const cvParams = searchParams.getAll("cv");
    const jdSlug = searchParams.get("jd");

    const query = priorRunQuery({ cvHashes: cvParams, jdSlug, blind: false });
    if (!query) {
      return NextResponse.json({ ok: true, rows: [] });
    }

    const rows = listPriorRunsByCvHashes(query.cvHashes, ws);
    return NextResponse.json({ ok: true, rows });
  } catch (error) {
    return safeJsonError(error, "api/analyze/prior", "ANALYSES_LIST_FAILED");
  }
});
