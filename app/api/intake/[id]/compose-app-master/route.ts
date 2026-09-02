import { NextResponse } from "next/server";
import { getIntake, updateIntakeAppMaster, type AppMasterCompose } from "@/app/_lib/db/intakes";
import { briefToAppMasterSpec } from "@/app/_lib/intake-brief";
import { runIntakeAppMasterSync } from "@/app/_lib/intake-run";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

// POST /api/intake/[id]/compose-app-master — turn the captured RoleBrief plus
// the session's RepoDossier into an `AppMasterSpec`
// (docs/features/app-master/README.md §2.4), and re-judge the population fit
// over the objectives as they stand right now.
//
// The spec itself is composed by a PURE function (`briefToAppMasterSpec`,
// validated with `appMasterSpecSchema`) — no model writes a mandate, a budget
// or a forbidden-class list. The model's only job is the per-objective coverage
// classification behind the fit verdict, and even there the ratio and the
// verdict are computed in code (pipeline/jobfit/agentfit.py).
//
// Composing does NOT hire anything. The human population promotes through the
// existing JD build (`/api/intake/[id]/promote`); the agent population's
// dispatch to Personas is P4 and the UI says so on a disabled control.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const intake = getIntake(id, ws);
    if (!intake) return NextResponse.json({ error: "Intake not found." }, { status: 404 });
    if (intake.status === "promoted") {
      return NextResponse.json({ error: "This intake was promoted — its spec is frozen." }, { status: 409 });
    }
    if (intake.shape !== "app_master") {
      return NextResponse.json({ error: "This is not an App master intake." }, { status: 400 });
    }
    if (!intake.dossier) {
      return NextResponse.json({ error: "The repo scan has not landed yet." }, { status: 409 });
    }
    if (!intake.brief) {
      return NextResponse.json({ error: "The brief is empty — answer the dialog first." }, { status: 400 });
    }

    // THROTTLE (rate-limit-contract.test.ts): spawns Python and may spend on the
    // `agent_fit` use case. Composing is a re-readable, idempotent operation a
    // requestor presses after each answer, so the ceiling is generous — 30/10min
    // per IP — but it is not unbounded. AFTER the refusals, BEFORE the spawn.
    // (Expensive marker: `runIntakeAppMasterSync(`.)
    if (!rateLimit(`intake-compose:${clientIpFrom(request.headers)}`, { limit: 30, windowMs: 10 * 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }

    const sync = await runIntakeAppMasterSync({
      brief: intake.brief,
      dossier: intake.dossier,
      lang: intake.lang === "cs" ? "cs" : "en",
    });
    // Compose from the SYNCED brief, so a dossier facet the merge just refreshed
    // is what the spec was built from — not a copy read before it.
    const spec = briefToAppMasterSpec(sync.brief, intake.dossier);
    const compose: AppMasterCompose = { spec, fit: sync.fit, composedAt: new Date().toISOString() };
    // The merged brief is PERSISTED beside the spec, in the one write, under the
    // same compare-and-swap. It used to be returned and dropped: the client
    // adopted `sync.brief` through applySession and the next reload handed back
    // the un-merged row, so a requestor watched their own screen revert. Not
    // returning it instead would have been the cheaper fix and the wrong one —
    // the merge is real work the spawn just paid for, and the spec stored beside
    // it was composed FROM it, so a row holding the spec without its brief is a
    // record of a decision with its evidence deleted.
    const write = updateIntakeAppMaster(id, compose, ws, {
      brief: sync.brief,
      expectedUpdatedAt: intake.updatedAt,
    });
    if (write === "missing") {
      return NextResponse.json({ error: "Intake not found." }, { status: 404 });
    }
    if (write === "moved") {
      return jsonRefusal("INTAKE_BRIEF_MOVED", 409);
    }
    return NextResponse.json({ spec, fit: sync.fit, composedAt: compose.composedAt, brief: sync.brief });
  } catch (error) {
    return safeJsonError(error, "api:intake/compose-app-master", "INTAKE_COMPOSE_APP_MASTER_FAILED");
  }
}
