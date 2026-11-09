//   GET /api/outreach-letters/by-entry/[entryId] -> { letter, preview } | { letter: null, preview: null }
//
// The drawer's lookup from an application to the outreach letter held for it (comms scope
// C2b), in the same shape as GET ../[id]. An application with no letter answers 200 with
// nulls (the drawer shows no card); an application that is not in the caller's workspace
// answers 404 exactly as if it did not exist. READ-ONLY, recruiter PII class: requireOperator
// first, every read scoped to the caller's workspace.
import { NextResponse } from "next/server";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { getPipelineEntry } from "@/app/_lib/db/pipeline";
import { outreachLetterByEntry } from "@/app/_lib/db/outreach-letters";
import { outreachLetterView } from "../../letter-view";

export const GET = withWorkspace(async (ws: string, request: Request, { params }: { params: Promise<{ entryId: string }> }) => {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { entryId } = await params;
    const entry = getPipelineEntry(entryId, ws);
    if (!entry) return jsonRefusal("PIPELINE_ENTRY_NOT_FOUND", 404);
    const letter = outreachLetterByEntry(entryId, ws);
    if (!letter) return NextResponse.json({ letter: null, preview: null });
    return NextResponse.json(await outreachLetterView(letter, entry, ws, new URL(request.url).origin));
  } catch (error) {
    return safeJsonError(error, "api:outreach-letters", "OUTREACH_FAILED");
  }
});
