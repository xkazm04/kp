import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { getDialog } from "@/app/_lib/db/jobseeker-dialogs";

// GET /api/jobseeker/dialogs/[id] — one dialog, transcript + artifact. The client
// re-reads through here after a `moved` (409) rather than painting its stale copy.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const dialog = getDialog(id, await currentWorkspace());
    if (!dialog) return jsonRefusal("JOBSEEKER_DIALOG_NOT_FOUND", 404);
    return NextResponse.json({ dialog });
  } catch (err) {
    return safeJsonError(err, "api:jobseeker/dialogs/[id]", "JOBSEEKER_STORE_FAILED");
  }
}
