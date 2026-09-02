import { NextResponse } from "next/server";
import { getIntake, updateIntakeDossier } from "@/app/_lib/db/intakes";
import { runIntakeAppMasterSync } from "@/app/_lib/intake-run";
import { repoDossierSchema } from "@/app/_lib/schemas.generated";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

// POST /api/intake/[id]/dossier — an App-master session's repo scan finished:
// fold the RepoDossier into the live brief as `codebase_dossier.*` facets
// (provenance `inferred`, via the same merge_brief path a dialog turn uses) and
// judge the population fit over whatever objectives the requestor has chosen so
// far. Body: `{ scanId, dossier }`.
//
// Why the client carries the dossier instead of the server re-reading the scan
// store: the scan is P2's surface and its store is not this module's to reach
// into. The trust posture is the one PATCH /brief already runs — a client-shaped
// payload is clamped at the boundary (`repoDossierSchema.safeParse`) before it
// touches a row — plus one more gate: the `scanId` must be the one THIS intake
// was created from, so a dossier from another session's scan cannot be posted
// onto this brief.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const intake = getIntake(id, ws);
    // Every refusal below answers with a CODE (docs/architecture/api-contracts.md
    // §1.1). They used to be bare English strings, so the card could only say
    // "compose failed" — and said it in English regardless of the reader's
    // locale. The reason a requestor cannot proceed IS the information here.
    if (!intake) return jsonRefusal("INTAKE_NOT_FOUND", 404);
    if (intake.status === "promoted") return jsonRefusal("INTAKE_FROZEN", 409);
    if (!intake.scanId) return jsonRefusal("INTAKE_NOT_FROM_SCAN", 400);

    const body = (await request.json().catch(() => ({}))) as { scanId?: unknown; dossier?: unknown };
    if (typeof body.scanId !== "string" || body.scanId.trim() !== intake.scanId) {
      return jsonRefusal("INTAKE_SCAN_MISMATCH", 400);
    }
    const parsed = repoDossierSchema.safeParse(body.dossier);
    if (!parsed.success) return jsonRefusal("INTAKE_DOSSIER_INVALID", 400);

    // THROTTLE (rate-limit-contract.test.ts): this spawns Python — the merge is
    // deterministic but the population fit is a real, potentially-paid model
    // call on the `agent_fit` use case. One scan produces one dossier, so a
    // human never posts twice; 20/10min per IP pins a client whose poll loop
    // has gone wrong while leaving a re-scan room to land. AFTER the cheap
    // refusals so a rejected post never spends. (Expensive marker:
    // `runIntakeAppMasterSync(`.)
    if (!rateLimit(`intake-dossier:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    // The caller's signal rides into the spawn: a requestor who navigated away
    // (or pressed Cancel on the compose sibling) should not leave a Python
    // process reading a repository on their behalf.
    const sync = await runIntakeAppMasterSync(
      {
        brief: intake.brief,
        dossier: parsed.data,
        lang: intake.lang === "cs" ? "cs" : "en",
      },
      request.signal
    );
    // COMPARE-AND-SWAP, not a blind write. `intake.updatedAt` was read BEFORE the
    // spawn above, which can take minutes; a dialog turn landing inside that
    // window has already replaced the brief this merge was computed from, and
    // storing `sync.brief` over it would regress a value the requestor STATED —
    // the one thing the merge rule forbids. The refusal is the honest outcome:
    // the client re-posts on its next tick against the current row.
    const write = updateIntakeDossier(
      id,
      { scanId: intake.scanId, dossier: parsed.data, brief: sync.brief, expectedUpdatedAt: intake.updatedAt },
      ws
    );
    if (write === "missing") {
      return jsonRefusal("INTAKE_NOT_FOUND", 404);
    }
    if (write === "moved") {
      return jsonRefusal("INTAKE_BRIEF_MOVED", 409);
    }
    return NextResponse.json({ brief: sync.brief, shape: sync.shape, dossier: parsed.data, fit: sync.fit });
  } catch (error) {
    // An aborted request is not a fault: the client is gone, and logging it as a
    // store error would file a deliberate cancel as an incident.
    if (request.signal.aborted) return new NextResponse(null, { status: 499 });
    return safeJsonError(error, "api:intake/dossier", "INTAKE_DOSSIER_FAILED");
  }
}
