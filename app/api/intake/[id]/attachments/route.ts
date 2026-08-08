import { NextResponse } from "next/server";
import { getIntake, updateIntakeAttachments, type IntakeAttachment } from "@/app/_lib/db/intakes";
import { loadJd } from "@/app/_lib/db/jobs";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";

// POST /api/intake/[id]/attachments — attach reference material to a session
// (a colleague's note pasted as text, or a saved JD picked from the library),
// or remove one. The dialog engine grounds on the list (fenced as third-party
// DATA — values mined from it enter the brief as `inferred` until confirmed).
//
// Caps (the trust boundary for free-typed content): ≤5 attachments per
// session, note text ≤20k chars, title ≤120. A JD attachment is resolved
// SERVER-SIDE from the workspace's library (`loadJd`) — the client sends only
// the slug, never the body, so an attachment of kind "jd" always reflects the
// stored document. Promoted sessions are frozen (same rule as the brief).

export const ATTACHMENT_LIMIT = 5;
export const ATTACHMENT_TEXT_MAX = 20_000;

type Body = { action?: unknown; kind?: unknown; title?: unknown; text?: unknown; jdSlug?: unknown; index?: unknown };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const intake = getIntake(id, ws);
    if (!intake) return NextResponse.json({ error: "Intake not found." }, { status: 404 });
    if (intake.status === "promoted") {
      return NextResponse.json({ error: "This session was promoted — its record is frozen." }, { status: 409 });
    }
    const body = (await request.json().catch(() => ({}))) as Body;

    let next: IntakeAttachment[];
    if (body.action === "remove") {
      const index = typeof body.index === "number" && Number.isInteger(body.index) ? body.index : -1;
      if (index < 0 || index >= intake.attachments.length) {
        return NextResponse.json({ error: "index out of range" }, { status: 400 });
      }
      next = intake.attachments.filter((_, i) => i !== index);
    } else {
      if (intake.attachments.length >= ATTACHMENT_LIMIT) {
        return NextResponse.json({ error: "attachment limit reached" }, { status: 400 });
      }
      const kind = body.kind === "jd" ? "jd" : "note";
      let attachment: IntakeAttachment;
      if (kind === "jd") {
        const jdSlug = typeof body.jdSlug === "string" ? body.jdSlug.trim() : "";
        const jd = jdSlug ? loadJd(jdSlug, ws) : null;
        if (!jd) return NextResponse.json({ error: "JD not found." }, { status: 404 });
        attachment = {
          kind: "jd",
          title: (jd.title || jdSlug).slice(0, 120),
          text: (jd.body || "").slice(0, ATTACHMENT_TEXT_MAX),
          jdSlug,
        };
      } else {
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
        const title = typeof body.title === "string" ? body.title.trim() : "";
        attachment = {
          kind: "note",
          title: (title || "Note").slice(0, 120),
          text: text.slice(0, ATTACHMENT_TEXT_MAX),
        };
      }
      next = [...intake.attachments, attachment];
    }

    if (!updateIntakeAttachments(id, next, ws)) {
      return NextResponse.json({ error: "Intake not found." }, { status: 404 });
    }
    return NextResponse.json({ attachments: next });
  } catch (error) {
    return safeJsonError(error, "api:intake/attachments", "INTAKE_ATTACHMENT_FAILED");
  }
}
