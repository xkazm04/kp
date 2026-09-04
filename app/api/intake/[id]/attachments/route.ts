import { NextResponse } from "next/server";
import { getIntake, updateIntakeAttachments, type IntakeAttachment } from "@/app/_lib/db/intakes";
import { loadJd } from "@/app/_lib/db/jobs";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
// The caps live in a sibling module: Next's generated route types reject any
// non-handler `export const` here (backlog item 57).
import { ATTACHMENT_LIMIT, ATTACHMENT_TEXT_MAX } from "./attachment-limits";

// POST /api/intake/[id]/attachments — attach reference material to a session
// (a colleague's note pasted as text, or a saved JD picked from the library),
// or remove one. The dialog engine grounds on the list (fenced as third-party
// DATA — values mined from it enter the brief as `inferred` until confirmed).
//
// Caps (the trust boundary for free-typed content): ≤5 attachments per
// session, note text ≤20k chars (REFUSED past it, never truncated), title ≤120
// and stored as given — an untitled note stays untitled and the reader's own
// language supplies the fallback. A JD attachment is resolved
// SERVER-SIDE from the workspace's library (`loadJd`) — the client sends only
// the slug, never the body, so an attachment of kind "jd" always reflects the
// stored document. Promoted sessions are frozen (same rule as the brief).

type Body = { action?: unknown; kind?: unknown; title?: unknown; text?: unknown; jdSlug?: unknown; index?: unknown };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const intake = getIntake(id, ws);
    // Five distinct refusals on this route, and the pane painted one red
    // "attachment failed" for every one of them: full, gone, no such JD, empty
    // note, frozen session. Each carries its code now (api-contracts.md §1.1).
    if (!intake) return jsonRefusal("INTAKE_NOT_FOUND", 404);
    if (intake.status === "promoted") return jsonRefusal("INTAKE_FROZEN", 409);
    const body = (await request.json().catch(() => ({}))) as Body;

    let next: IntakeAttachment[];
    if (body.action === "remove") {
      const index = typeof body.index === "number" && Number.isInteger(body.index) ? body.index : -1;
      if (index < 0 || index >= intake.attachments.length) {
        return jsonRefusal("INTAKE_ATTACHMENT_INDEX", 400);
      }
      next = intake.attachments.filter((_, i) => i !== index);
    } else {
      if (intake.attachments.length >= ATTACHMENT_LIMIT) {
        // The cap rides alongside as a NUMBER, so the reader's own sentence can
        // say it instead of the server's English prose carrying it.
        return jsonRefusal("INTAKE_ATTACHMENT_LIMIT", 400, { max: ATTACHMENT_LIMIT });
      }
      const kind = body.kind === "jd" ? "jd" : "note";
      let attachment: IntakeAttachment;
      if (kind === "jd") {
        const jdSlug = typeof body.jdSlug === "string" ? body.jdSlug.trim() : "";
        const jd = jdSlug ? loadJd(jdSlug, ws) : null;
        if (!jd) return jsonRefusal("INTAKE_JD_NOT_FOUND", 404);
        attachment = {
          kind: "jd",
          title: (jd.title || jdSlug).slice(0, 120),
          text: (jd.body || "").slice(0, ATTACHMENT_TEXT_MAX),
          jdSlug,
        };
      } else {
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) return jsonRefusal("INTAKE_TEXT_REQUIRED", 400);
        // A note over the cap is REFUSED, not silently truncated. Trimming it
        // here told the requestor their whole pasted thread had been attached
        // while the agent grounded on a document missing its tail — the count
        // cap already sets the honest precedent (a refusal carrying `max`, from
        // which the composer restores the typed text). A JD body still slices:
        // it is server-resolved from the library, not something anyone typed.
        if (text.length > ATTACHMENT_TEXT_MAX) {
          return jsonRefusal("INTAKE_ATTACHMENT_TOO_LONG", 400, { max: ATTACHMENT_TEXT_MAX });
        }
        // The title is stored EXACTLY as given — empty when the requestor gave
        // none. It used to be defaulted to the English literal "Note", which
        // persisted one locale's word into every workspace's data and read as
        // "Note" to a Czech reader forever after; the fallback is a render-time
        // concern and lives in the pane (attachments.noteFallbackTitle).
        const title = typeof body.title === "string" ? body.title.trim() : "";
        attachment = { kind: "note", title: title.slice(0, 120), text };
      }
      next = [...intake.attachments, attachment];
    }

    if (!updateIntakeAttachments(id, next, ws)) return jsonRefusal("INTAKE_NOT_FOUND", 404);
    return NextResponse.json({ attachments: next });
  } catch (error) {
    return safeJsonError(error, "api:intake/attachments", "INTAKE_ATTACHMENT_FAILED");
  }
}
