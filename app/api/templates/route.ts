import { NextRequest, NextResponse } from "next/server";
import { createTemplate, listTemplates } from "@/app/_lib/templates-store";
import { safeJsonError } from "@/app/_lib/api-response";
import { findUnknownPlaceholders, unknownPlaceholderMessage, validateTemplateFields } from "@/app/features/sub_library/render-template";


export async function GET() {
  try {
    return NextResponse.json({ templates: listTemplates() });
  } catch (error) {
    return safeJsonError(error, "api:templates", "TEMPLATE_LIST_FAILED");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { name?: string; body?: string };
    // Trim + cap name/body at the write boundary (mirrors the JD caps via the
    // shared validator) so an arbitrary-length body can't be stored and a
    // whitespace-only name can't slip through to be coerced to "Untitled template".
    const fields = validateTemplateFields(body.name, body.body);
    if (!fields.ok) return NextResponse.json({ error: fields.error }, { status: 400 });
    // Block unknown {{tokens}} before they can be stored and rendered raw onto a
    // public JD page (see the unknown-token policy in render-template.ts).
    const unknown = findUnknownPlaceholders(fields.body);
    if (unknown.length) return NextResponse.json({ error: unknownPlaceholderMessage(unknown) }, { status: 400 });
    return NextResponse.json({ template: createTemplate({ name: fields.name, body: fields.body }) });
  } catch (error) {
    return safeJsonError(error, "api:templates", "TEMPLATE_CREATE_FAILED");
  }
}
