import { NextResponse } from "next/server";
import { getIntake, updateIntakeBrief } from "@/app/_lib/db/intakes";
import { sanitizeEditedBrief } from "@/app/_lib/brief-edit";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

// PATCH /api/intake/[id]/brief — a HUMAN edit of the live brief (UAT drain
// §2.1: "I can't fix what it captured"). A typed edit is `stated` by
// definition, but that is a decision the SERVER makes: the stored brief is
// handed to `sanitizeEditedBrief` so every provenance is resolved from
// (stored, incoming) — a `stated` grading never regresses, and a payload that
// omits provenance can never mint one (brief-edit.ts, the TS twin of
// pipeline/jobfit/intake.py::merge_brief). The route also enforces SHAPE
// (closed vocabularies, 0..1 clamps, caps — same module) and the lifecycle: a
// PROMOTED session's brief is frozen (the JD exists; 409 with a clear note —
// re-promoting an edited brief is future work, documented in the feature doc).
// The transcript is never touched by an edit — the dialog record stays honest.
//
// The body is parsed BEFORE the row is read so that nothing awaits between the
// read that supplies the merge basis and the write that replaces it: this is a
// read→compute→write over one row, and the await used to sit right in the
// middle of it.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const body = (await request.json().catch(() => ({}))) as { brief?: unknown };
    const intake = getIntake(id, ws);
    // Codes, never prose (docs/architecture/api-contracts.md §1.1): the brief
    // panel rendered "save failed" for all three of these, so a frozen session
    // and a malformed payload read identically, in English, to every locale.
    if (!intake) return jsonRefusal("INTAKE_NOT_FOUND", 404);
    if (intake.status === "promoted") return jsonRefusal("INTAKE_FROZEN", 409);
    const brief = sanitizeEditedBrief(body.brief, intake.brief);
    if (!brief) return jsonRefusal("INTAKE_BRIEF_INVALID", 400);
    // The version that supplied the merge basis is re-asserted in the write, so
    // the edit lands on the row it was merged against or not at all — the same
    // ok/moved/missing vocabulary every other intake write now speaks.
    const write = updateIntakeBrief(id, brief, ws, { expectedUpdatedAt: intake.updatedAt });
    if (write === "missing") return jsonRefusal("INTAKE_NOT_FOUND", 404);
    if (write === "moved") return jsonRefusal("INTAKE_BRIEF_MOVED", 409);
    return NextResponse.json({ brief });
  } catch (error) {
    return safeJsonError(error, "api:intake/brief", "INTAKE_BRIEF_SAVE_FAILED");
  }
}
