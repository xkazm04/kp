import { NextResponse } from "next/server";
import { getIntake, reopenIntake } from "@/app/_lib/db/intakes";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

// POST /api/intake/[id]/reopen — flip a `complete` session back to `open`
// (UAT drain §2.1: the read-back closed, then a new thought arrived). A system
// turn is appended so the transcript honestly records the re-open; PROMOTED
// sessions stay closed (the JD exists). Body: { note? } — an optional
// localized system-turn text from the client; a server default applies.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const intake = getIntake(id, ws);
    if (!intake) return jsonRefusal("INTAKE_NOT_FOUND", 404);
    // Two different 409s that used to be two English sentences behind one
    // "could not re-open": a promoted session is final (start a new one), an
    // already-open one needs no action at all.
    if (intake.status !== "complete") {
      return jsonRefusal(intake.status === "promoted" ? "INTAKE_FROZEN" : "INTAKE_ALREADY_OPEN", 409);
    }
    const body = (await request.json().catch(() => ({}))) as { note?: unknown };
    const note =
      typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : "Session re-opened by the requestor.";
    const reopened = reopenIntake(id, note, ws);
    if (!reopened) return jsonRefusal("INTAKE_NOT_FOUND", 404);
    return NextResponse.json(reopened);
  } catch (error) {
    return safeJsonError(error, "api:intake/reopen", "INTAKE_REOPEN_FAILED");
  }
}
