import { NextResponse } from "next/server";
import { getIntake, updateIntakeDossier } from "@/app/_lib/db/intakes";
import { runIntakeAppMasterSync } from "@/app/_lib/intake-run";
import { repoDossierSchema } from "@/app/_lib/schemas.generated";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { safeJsonError } from "@/app/_lib/api-response";

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
    if (!intake) return NextResponse.json({ error: "Intake not found." }, { status: 404 });
    if (intake.status === "promoted") {
      return NextResponse.json({ error: "This intake was promoted — its grounding is frozen." }, { status: 409 });
    }
    if (!intake.scanId) {
      return NextResponse.json({ error: "This intake was not started from a repo scan." }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as { scanId?: unknown; dossier?: unknown };
    if (typeof body.scanId !== "string" || body.scanId.trim() !== intake.scanId) {
      return NextResponse.json({ error: "scanId does not match this intake's scan." }, { status: 400 });
    }
    const parsed = repoDossierSchema.safeParse(body.dossier);
    if (!parsed.success) return NextResponse.json({ error: "dossier is not a RepoDossier" }, { status: 400 });

    // THROTTLE (rate-limit-contract.test.ts): this spawns Python — the merge is
    // deterministic but the population fit is a real, potentially-paid model
    // call on the `agent_fit` use case. One scan produces one dossier, so a
    // human never posts twice; 20/10min per IP pins a client whose poll loop
    // has gone wrong while leaving a re-scan room to land. AFTER the cheap
    // refusals so a rejected post never spends. (Expensive marker:
    // `runIntakeAppMasterSync(`.)
    if (!rateLimit(`intake-dossier:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }

    const sync = await runIntakeAppMasterSync({
      brief: intake.brief,
      dossier: parsed.data,
      lang: intake.lang === "cs" ? "cs" : "en",
    });
    if (!updateIntakeDossier(id, { scanId: intake.scanId, dossier: parsed.data, brief: sync.brief }, ws)) {
      return NextResponse.json({ error: "Intake not found." }, { status: 404 });
    }
    return NextResponse.json({ brief: sync.brief, shape: sync.shape, dossier: parsed.data, fit: sync.fit });
  } catch (error) {
    return safeJsonError(error, "api:intake/dossier", "INTAKE_DOSSIER_FAILED");
  }
}
