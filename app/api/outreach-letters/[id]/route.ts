//   PATCH below edits a drafted letter.
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
import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonOk, jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";
import { cleanOutreachBody, outreachBodyRefusal, OUTREACH_BODY_MAX_LENGTH } from "@/app/_lib/outreach-body";
import { getPipelineEntry } from "@/app/_lib/db/pipeline";
import {
  cleanOutreachSubject,
  outreachLetterById,
  outreachLetterEdit,
  OUTREACH_SUBJECT_MAX_LENGTH,
} from "@/app/_lib/db/outreach-letters";
import { outreachLetterView } from "../letter-view";

export const GET = withWorkspace(async (ws: string, request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const letter = outreachLetterById(id, ws);
    if (!letter) return jsonRefusal("OUTREACH_LETTER_NOT_FOUND", 404);
    const entry = getPipelineEntry(letter.entryId, ws);
    if (!entry) return jsonRefusal("OUTREACH_LETTER_NOT_FOUND", 404);
    return NextResponse.json(await outreachLetterView(letter, entry, ws, new URL(request.url).origin));
  } catch (error) {
    return safeJsonError(error, "api:outreach-letters", "OUTREACH_FAILED");
  }
});

// PATCH /api/outreach-letters/[id] — a person edits a still-`drafted` letter (the bulk
// dry-run sheet's per-letter edit, comms scope C2b).
//
//   body { revision: number, subject: string, body: string }   the revision the editor read
//   200 { letter, preview }    the SAME shape as GET: the stored text at its NEW revision
//                              and the letter a release would send
//   404 OUTREACH_LETTER_NOT_FOUND       not in this team
//   409 OUTREACH_LETTER_CONFLICT + { state, revision }   stale revision, or no longer drafted
//                                      (approved / released / erased), or no revision named
//   413 PAYLOAD_TOO_LARGE · 422 FEEDBACK_LETTER_TEXT_EMPTY
//   422 OUTREACH_BODY_TOO_LONG         the body, or the subject (over OUTREACH_SUBJECT_MAX_LENGTH)
//   500 OUTREACH_FAILED · 401 / 403 FORBIDDEN_CAPABILITY
//
// An edit bumps the revision, so an approval that names the pre-edit revision is refused
// by the approve door's own CAS: nobody approves text they did not read. The text is
// cleaned and length-checked the way the send gate will check it (outreach-body.ts), so a
// letter that could never be released is refused here, while it can still be fixed. The
// subject gets the same cleaning folded onto one line (cleanOutreachSubject) and its own cap.
const MAX_EDIT_BODY_BYTES = OUTREACH_BODY_MAX_LENGTH * 4 + 4096;

export const PATCH = withWorkspace(async (ws: string, request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  try {
    const { id } = await params;
    const input = await readJsonWithLimit<{ revision?: unknown; subject?: unknown; body?: unknown }>(request, MAX_EDIT_BODY_BYTES, {});
    if (input === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_EDIT_BODY_BYTES });
    const letter = outreachLetterById(id, ws);
    if (!letter) return jsonRefusal("OUTREACH_LETTER_NOT_FOUND", 404);
    const entry = getPipelineEntry(letter.entryId, ws);
    if (!entry) return jsonRefusal("OUTREACH_LETTER_NOT_FOUND", 404);
    const { revision } = input;
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
      return jsonRefusal("OUTREACH_LETTER_CONFLICT", 409, { state: letter.state, revision: letter.revision });
    }
    if (typeof input.subject !== "string" || typeof input.body !== "string") {
      return jsonRefusal("FEEDBACK_LETTER_TEXT_EMPTY", 422);
    }
    const subject = cleanOutreachSubject(input.subject);
    const body = cleanOutreachBody(input.body).trim();
    if (!subject || !body) return jsonRefusal("FEEDBACK_LETTER_TEXT_EMPTY", 422);
    if (outreachBodyRefusal(body) || subject.length > OUTREACH_SUBJECT_MAX_LENGTH) return jsonRefusal("OUTREACH_BODY_TOO_LONG", 422);

    const edited = outreachLetterEdit(id, { revision, subject, body }, ws);
    if (!edited) {
      const now = outreachLetterById(id, ws);
      return jsonRefusal("OUTREACH_LETTER_CONFLICT", 409, { state: now?.state ?? null, revision: now?.revision ?? null });
    }
    return jsonOk(await outreachLetterView(edited.letter, entry, ws, new URL(request.url).origin));
  } catch (error) {
    return safeJsonError(error, "api:outreach-letters:edit", "OUTREACH_FAILED");
  }
});
