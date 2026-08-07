import { NextResponse } from "next/server";
import { createIntake, listIntakes } from "@/app/_lib/db/intakes";
import { runIntakeOpening } from "@/app/_lib/intake-run";
import { updateIntakeDialog } from "@/app/_lib/db/intakes";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";

// Role-intake dialogs (docs/concepts/role-intake-dialog.md, Phase 1).
// POST — start a session: create the row and seed the agent's deterministic
// opener into the transcript (no LLM call; the opener is fixed by design so
// the first impression is identical keyless and keyed).
// GET — the workspace's intake ledger.

export async function POST(request: Request) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => ({}))) as { title?: unknown; lang?: unknown };
    const lang = body.lang === "cs" ? "cs" : "en";
    const ws = await currentWorkspace();
    const intake = createIntake({ title: typeof body.title === "string" ? body.title : "", lang }, ws);
    const opening = await runIntakeOpening(lang);
    const transcript = [{ role: "interviewer" as const, text: opening.reply, at: new Date().toISOString() }];
    updateIntakeDialog(intake.id, { transcript, brief: opening.brief }, ws);
    return NextResponse.json({ ...intake, transcript, brief: opening.brief });
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
