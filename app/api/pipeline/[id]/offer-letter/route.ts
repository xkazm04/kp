//   GET /api/pipeline/[id]/offer-letter?ttlDays=N -> OfferLetterPreview
//     { locale, subject, body, recipient, forecast, forecastReason, ttlDays, expiresAt }
//
// The offer letter an approval of this
// entry would send, rendered through the send path's own composer, plus a delivery
// forecast (challenge-r06 comms-dispatch-relay/B). READ-ONLY: no token is minted, no
// offer row is created, nothing is recorded (comms-letter-preview.ts states why each
// read is a read).
//
// AUTH: the letter carries the candidate's name, address and offer terms - the same
// recruiter PII class as the sibling /api/pipeline/[id]/timeline, so requireOperator
// runs first and every read is scoped to the caller's workspace.
//
// ttlDays is the card's deadline lever and changes as the recruiter types, so it is
// RESOLVED (resolveOfferTtlDays: out of range or junk -> the deployment default, the
// same rule the extend path applies), never refused: the preview shows the deadline
// the approval would actually stamp.
import { NextResponse } from "next/server";
import { getPipelineEntry } from "@/app/_lib/db/pipeline";
import { previewOfferLetter } from "@/app/_lib/comms-letter-preview";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const workspaceId = await currentWorkspace();
    const entry = getPipelineEntry(id, workspaceId);
    if (entry === null) return jsonRefusal("PIPELINE_ENTRY_NOT_FOUND", 404);
    if (entry.approvalKind !== "offer_review") return jsonRefusal("OFFER_LETTER_NOT_PENDING", 409);
    const url = new URL(request.url);
    const raw = url.searchParams.get("ttlDays");
    const preview = await previewOfferLetter(entry, {
      ttlDays: raw === null ? null : Number(raw),
      origin: url.origin,
    });
    return NextResponse.json(preview);
  } catch (error) {
    return safeJsonError(error, "api:pipeline:offer-letter", "OFFER_LETTER_PREVIEW_FAILED");
  }
}
