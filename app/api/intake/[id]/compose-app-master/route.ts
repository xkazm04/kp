import { NextResponse } from "next/server";
import { getIntake, updateIntakeAppMaster, type AppMasterCompose } from "@/app/_lib/db/intakes";
import { briefToAppMasterSpec } from "@/app/_lib/intake-brief";
import { runIntakeAppMasterSync } from "@/app/_lib/intake-run";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { intakeLang } from "@/app/_lib/intake-lang";

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
    // Four DIFFERENT next actions, and the card used to render all four (plus a
    // throttle) as one English "compose failed" line: wait for the scan, answer
    // the dialog, start an App-master session, wait out the limiter. Each one
    // now carries its code and the card resolves it in the reader's language
    // (docs/architecture/api-contracts.md §1.1).
    if (!intake) return jsonRefusal("INTAKE_NOT_FOUND", 404);
    if (intake.status === "promoted") return jsonRefusal("INTAKE_FROZEN", 409);
    if (intake.shape !== "app_master") return jsonRefusal("INTAKE_NOT_APP_MASTER", 400);
    if (!intake.dossier) return jsonRefusal("INTAKE_SCAN_NOT_LANDED", 409);
    if (!intake.brief) return jsonRefusal("INTAKE_BRIEF_EMPTY", 400);

    // THROTTLE (rate-limit-contract.test.ts): spawns Python and may spend on the
    // `agent_fit` use case. Composing is a re-readable, idempotent operation a
    // requestor presses after each answer, so the ceiling is generous — 30/10min
    // per IP — but it is not unbounded. AFTER the refusals, BEFORE the spawn.
    // (Expensive marker: `runIntakeAppMasterSync(`.)
    if (!rateLimit(`intake-compose:${clientIpFrom(request.headers)}`, { limit: 30, windowMs: 10 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    // The requestor's Cancel is a real cancel: `request.signal` rides into the
    // spawn, so aborting the fetch kills the Python process instead of leaving a
    // 180-second `agent_fit` call running (and possibly spending) for a screen
    // nobody is watching.
    const sync = await runIntakeAppMasterSync(
      {
        brief: intake.brief,
        dossier: intake.dossier,
        lang: intakeLang(intake.lang),
      },
      request.signal
    );
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
      return jsonRefusal("INTAKE_NOT_FOUND", 404);
    }
    if (write === "moved") {
      return jsonRefusal("INTAKE_BRIEF_MOVED", 409);
    }
    return NextResponse.json({ spec, fit: sync.fit, composedAt: compose.composedAt, brief: sync.brief });
  } catch (error) {
    // A cancelled compose is a decision, not a fault — no store-error log, no
    // 500 the client would render as "the spec could not be composed".
    if (request.signal.aborted) return new NextResponse(null, { status: 499 });
    return safeJsonError(error, "api:intake/compose-app-master", "INTAKE_COMPOSE_APP_MASTER_FAILED");
  }
}
