import { NextRequest, NextResponse } from "next/server";
import { deleteTemplate, getTemplate, setDefaultTemplate, updateTemplate } from "@/app/_lib/templates-store";
import { safeJsonError } from "@/app/_lib/api-response";
import { findUnknownPlaceholders, unknownPlaceholderMessage, validateTemplateUpdate } from "@/app/features/sub_library/render-template";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const template = getTemplate(id);
    if (!template) return NextResponse.json({ error: "Template not found." }, { status: 404 });
    return NextResponse.json({ template });
  } catch (error) {
    return safeJsonError(error, "api:templates/[id]", "TEMPLATE_LOAD_FAILED");
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as { name?: string; body?: string; isDefault?: boolean };
    // Promote-to-default is a distinct, single-row state change (clears the flag
    // on every other template), kept separate from a name/body edit — it carries
    // no name/body to trim, cap, or lint.
    if (body.isDefault === true) {
      const template = setDefaultTemplate(id);
      if (!template) return NextResponse.json({ error: "Template not found." }, { status: 404 });
      return NextResponse.json({ template });
    }
    // Trim + cap whichever of name/body this edit carries (same caps/wording as
    // create, via the shared validator), so a partial edit can't store an empty
    // name/body or blow past the caps.
    const fields = validateTemplateUpdate(body);
    if (!fields.ok) return NextResponse.json({ error: fields.error }, { status: 400 });
    // Block unknown {{tokens}} on a body edit before they can be stored and
    // rendered raw onto a public JD page (see render-template.ts). Skipped when
    // body is absent — e.g. a rename-only edit.
    if (fields.body !== undefined) {
      const unknown = findUnknownPlaceholders(fields.body);
      if (unknown.length) return NextResponse.json({ error: unknownPlaceholderMessage(unknown) }, { status: 400 });
    }
    const template = updateTemplate(id, fields);
    if (!template) return NextResponse.json({ error: "Template not found." }, { status: 404 });
    return NextResponse.json({ template });
  } catch (error) {
    return safeJsonError(error, "api:templates/[id]", "TEMPLATE_UPDATE_FAILED");
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const result = deleteTemplate(id);
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeJsonError(error, "api:templates/[id]", "TEMPLATE_DELETE_FAILED");
  }
}
