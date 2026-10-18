//   GET /api/outreach-letters/[id] -> { letter, preview }
//     letter  { id, entryId, state, revision, subject, body, lang, messageId,
//               approvedBy, approvedAt, releasedAt, createdAt, updatedAt }
//     preview { locale, subject, body, recipient, forecast, forecastReason }
//
// A held first-contact outreach (comms scope C2) and the letter its release would send:
// the stored draft plus the legal footers every candidate comm carries, with every
// capability link replaced by comms-letter-preview.ts's PREVIEW_TOKEN, and a delivery
// forecast read off the send path's own predicates in the order it applies them (the
// offer preview's vocabulary: refused / simulation / suppressed / relay / local). The
// `revision` is what an approval must name (POST ./approve).
//
// READ-ONLY: no token is minted, nothing is recorded. AUTH: the letter carries the
// candidate's name and address — the recruiter PII class of /api/pipeline/[id]/offer-letter,
// so requireOperator runs first and every read is scoped to the caller's workspace (a
// letter id from another team answers 404).
import { NextResponse } from "next/server";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { getPipelineEntry } from "@/app/_lib/db/pipeline";
import { outreachLetterById } from "@/app/_lib/db/outreach-letters";
import { outreachLetterView } from "../letter-view";

export const GET = withWorkspace(async (ws: string, request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const letter = outreachLetterById(id, ws);
    if (!letter) return jsonRefusal("PIPELINE_ENTRY_NOT_FOUND", 404);
    const entry = getPipelineEntry(letter.entryId, ws);
    if (!entry) return jsonRefusal("PIPELINE_ENTRY_NOT_FOUND", 404);
    return NextResponse.json(await outreachLetterView(letter, entry, ws, new URL(request.url).origin));
  } catch (error) {
    return safeJsonError(error, "api:outreach-letters", "OUTREACH_FAILED");
  }
});
