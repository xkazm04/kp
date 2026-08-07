import { NextRequest, NextResponse } from "next/server";
import { createTemplate, listTemplates } from "@/app/_lib/templates-store";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { safeJsonError } from "@/app/_lib/api-response";
import { findUnknownPlaceholders, unknownPlaceholderMessage, validateTemplateFields } from "@/app/features/sub_library/render-template";


export async function GET() {
  try {
    // The team's view: the org-shared library + this team's own private templates.
    return NextResponse.json({ templates: listTemplates(await currentWorkspace()) });
  } catch (error) {
    return safeJsonError(error, "api:templates", "TEMPLATE_LIST_FAILED");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { name?: string; body?: string; scope?: "org" | "team" };
    // Trim + cap name/body at the write boundary (mirrors the JD caps via the
    // shared validator) so an arbitrary-length body can't be stored and a
    // whitespace-only name can't slip through to be coerced to "Untitled template".
    const fields = validateTemplateFields(body.name, body.body);
    if (!fields.ok) return NextResponse.json({ error: fields.error }, { status: 400 });
    // Block unknown {{tokens}} before they can be stored and rendered raw onto a
    // public JD page (see the unknown-token policy in render-template.ts).
    const unknown = findUnknownPlaceholders(fields.body);
    if (unknown.length) return NextResponse.json({ error: unknownPlaceholderMessage(unknown) }, { status: 400 });
    // scope 'org' publishes to the shared company library (visible to every team);
    // default is team-private. Publishing is org-affecting — gate on a manage
    // capability once RBAC is enforced (KP_MULTI_WORKSPACE); today it's single-tenant.
    const scope = body.scope === "org" ? "org" : "team";
    return NextResponse.json({
      template: createTemplate({ name: fields.name, body: fields.body, scope }, await currentWorkspace()),
    });
  } catch (error) {
    return safeJsonError(error, "api:templates", "TEMPLATE_CREATE_FAILED");
  }
}
