import { NextResponse } from "next/server";
import { createIntake, listIntakes } from "@/app/_lib/db/intakes";
import { runIntakeOpening } from "@/app/_lib/intake-run";
import { updateIntakeDialog } from "@/app/_lib/db/intakes";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

// Role-intake dialogs (docs/concepts/role-intake-dialog.md, Phase 1).
// POST — start a session: create the row and seed the agent's deterministic
// opener into the transcript (no LLM call; the opener is fixed by design so
// the first impression is identical keyless and keyed).
// GET — the workspace's intake ledger.

export async function POST(request: Request) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => ({}))) as { title?: unknown; lang?: unknown; scanId?: unknown };
    const lang = body.lang === "cs" ? "cs" : "en";
    // App master (docs/features/app-master/README.md): the caller already
    // started a repo_scan and hands its id in. That id — an ACT, not a triage —
    // is what makes this an `app_master` session, so it is stamped at CREATE
    // (before any dossier exists) and the opener is that shape's own question.
    const scanId = typeof body.scanId === "string" && body.scanId.trim() ? body.scanId.trim().slice(0, 120) : null;

    // THROTTLE: the opener spawns `intake_cli --opening` — a Python subprocess
    // per request, the same premise the house pins for /api/extract-text — and
    // this is also the first hop of the spend chain (create → PATCH /brief →
    // /promote, a paid jd_build). Operator-gated, but in open mode (no
    // KP_OPERATOR_PASSWORD) that gate is a no-op for the whole API. 30/10min
    // per IP is far above human pace (a session is a ten-minute conversation);
    // it runs BEFORE createIntake so a refused call leaves no orphan row.
    // Pinned in app/api/rate-limit-contract.test.ts beside the other intake
    // throttles. That spec's `expensive` marker is the OPENING CALL below, not the
    // bare function name - the name also appears in this route's import and, until
    // this comment was rewritten, in the comment itself, both above the limiter, so
    // a generic marker fails on prose instead of on ordering.
    if (!rateLimit(`intake-create:${clientIpFrom(request.headers)}`, { limit: 30, windowMs: 10 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    const ws = await currentWorkspace();
    const intake = createIntake({ title: typeof body.title === "string" ? body.title : "", lang, scanId }, ws);
    const opening = await runIntakeOpening(lang, scanId ? "app_master" : undefined);
    const transcript = [{ role: "interviewer" as const, text: opening.reply, at: new Date().toISOString() }];
    updateIntakeDialog(intake.id, { transcript, brief: opening.brief, shape: opening.shape }, ws);
    return NextResponse.json({ ...intake, transcript, brief: opening.brief, shape: opening.shape ?? intake.shape });
  } catch (error) {
    return safeJsonError(error, "api:intake", "INTAKE_CREATE_FAILED");
  }
}

export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    return NextResponse.json({ intakes: listIntakes(ws) });
  } catch (error) {
    return safeJsonError(error, "api:intake", "INTAKE_LIST_FAILED");
  }
}
