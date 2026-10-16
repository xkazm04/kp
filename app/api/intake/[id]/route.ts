import { NextResponse } from "next/server";
import { getIntake } from "@/app/_lib/db/intakes";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

// GET /api/intake/[id] — one intake session (transcript + live brief).
// Workspace-scoped point read: a leaked id never resolves across tenants.
export const GET = withWorkspace(async (ws: string, _request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const intake = getIntake(id, ws);
    if (!intake) return jsonRefusal("INTAKE_NOT_FOUND", 404);
    return NextResponse.json(intake);
  } catch (error) {
    return safeJsonError(error, "api:intake/[id]", "INTAKE_READ_FAILED");
  }
});
