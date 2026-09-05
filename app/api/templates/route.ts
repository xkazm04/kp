import { NextRequest, NextResponse } from "next/server";
import { createTemplate, listTemplates } from "@/app/_lib/templates-store";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { safeJsonError } from "@/app/_lib/api-response";
import { findUnknownPlaceholders, unknownPlaceholderMessage, validateTemplateFields } from "@/app/features/shared/renderTemplate";


export async function GET() {
  try {
    // The team's view: the org-shared library + this team's own private templates.
    // Bounded (templates-store) — `truncated` rides along so the manager can SAY the
    // list is partial instead of quietly under-reporting the library.
    const { templates, truncated } = listTemplates(await currentWorkspace());
    return NextResponse.json({ templates, truncated });
  } catch (error) {
    return safeJsonError(error, "api:templates", "TEMPLATE_LIST_FAILED");
  }
}

export async function POST(request: NextRequest) {
  // Creating a template is a recruiter write — and a scope:'org' create PUBLISHES to
  // the shared company library visible to every team, so this must be operator-gated
  // (GET above stays open for reads). Open mode is a no-op.
  const denied = await requireOperator();
  if (denied) return denied;
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
    // default is team-private. Publishing is org-affecting, so the whole route is
    // operator-gated above; a finer-grained "manage templates" capability is still
    // future work once per-role RBAC lands (KP_MULTI_WORKSPACE).
    const scope = body.scope === "org" ? "org" : "team";
    return NextResponse.json({
      template: createTemplate({ name: fields.name, body: fields.body, scope }, await currentWorkspace()),
    });
  } catch (error) {
    return safeJsonError(error, "api:templates", "TEMPLATE_CREATE_FAILED");
  }
}
