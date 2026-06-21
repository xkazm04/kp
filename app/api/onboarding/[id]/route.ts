import { NextRequest, NextResponse } from "next/server";
import {
  getRunDetail,
  markSigned,
  requestSignature,
  saveIntake,
  setTaskDone,
} from "@/app/_lib/onboarding-store";
import { safeJsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";

// One onboarding run: GET the full detail, PATCH a checklist task / the entry
// questionnaire / a signature request or completion (the e-sign provider seam).
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const detail = getRunDetail(id);
    if (!detail) return NextResponse.json({ error: "Onboarding run not found." }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error) {
    return safeJsonError(error, "api:onboarding:run", "ONBOARDING_FAILED");
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      taskId?: string;
      done?: boolean;
      answers?: Record<string, unknown>;
      document?: string;
      signatureId?: string;
      signer?: string;
    };

    let detail = null;
    if (body.action === "task" && typeof body.taskId === "string") {
      detail = setTaskDone(id, body.taskId, body.done === true);
    } else if (body.action === "intake" && body.answers && typeof body.answers === "object") {
      detail = saveIntake(id, body.answers);
    } else if (body.action === "request_sign" && typeof body.document === "string") {
      detail = requestSignature(id, body.document);
    } else if (body.action === "sign" && typeof body.signatureId === "string") {
      detail = markSigned(body.signatureId, typeof body.signer === "string" ? body.signer : "Signed");
    } else {
      return NextResponse.json({ error: "Unknown or malformed onboarding action." }, { status: 400 });
    }

    if (!detail) return NextResponse.json({ error: "Onboarding run not found." }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error) {
    return safeJsonError(error, "api:onboarding:run", "ONBOARDING_FAILED");
  }
}
