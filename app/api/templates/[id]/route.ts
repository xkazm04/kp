import { NextRequest, NextResponse } from "next/server";
import { deleteTemplate, editTemplate, getTemplate, setDefaultTemplate } from "@/app/_lib/templates-store";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { findUnknownPlaceholders, unknownPlaceholderMessage, validateTemplateUpdate } from "@/app/features/shared/renderTemplate";


export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const template = getTemplate(id, await currentWorkspace());
    if (!template) return jsonRefusal("TEMPLATE_NOT_FOUND", 404);
    return NextResponse.json({ template });
  } catch (error) {
    return safeJsonError(error, "api:templates/[id]", "TEMPLATE_LOAD_FAILED");
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Editing a template or promoting it to the org default mutates shared library
  // state — recruiter-only. Gate before params/body (GET above stays open). Open
  // mode is a no-op.
  const denied = await requireOperator();
  if (denied) return denied;
  const { id } = await context.params;
  try {
    const ws = await currentWorkspace();
    const body = (await request.json()) as { name?: string; body?: string; isDefault?: boolean; expectedUpdatedAt?: string };
    // Promote-to-default is a distinct, single-row state change (clears the flag
    // on every other template), kept separate from a name/body edit — it carries
    // no name/body to trim, cap, or lint. Only an ORG template can be the default.
    if (body.isDefault === true) {
      const template = setDefaultTemplate(id, ws);
      if (!template) return jsonRefusal("TEMPLATE_DEFAULT_ORG_ONLY", 400);
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
    // Compare-and-swap on the stamp the editor loaded: a second recruiter's save
    // is REFUSED (409, carrying the winning row so the client can reload it) rather
    // than silently erasing the first. A client with no base stamp keeps the old
    // unconditional write — the CAS is opt-in on the wire, enforced when offered.
    const result = editTemplate(id, { ...fields, expectedUpdatedAt: body.expectedUpdatedAt }, ws);
    if (!result.ok) {
      if (result.reason === "notFound") return jsonRefusal("TEMPLATE_NOT_FOUND", 404);
      return jsonRefusal("TEMPLATE_STALE", 409, { template: result.template ?? null });
    }
    return NextResponse.json({ template: result.template });
  } catch (error) {
    return safeJsonError(error, "api:templates/[id]", "TEMPLATE_UPDATE_FAILED");
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Deleting a template — including an org-shared one every team can see — is
  // recruiter-only. Gate before params/DB. Open mode is a no-op.
  const denied = await requireOperator();
  if (denied) return denied;
  const { id } = await context.params;
  try {
    const result = deleteTemplate(id, await currentWorkspace());
    // Each refusal is a CODE the manager resolves in the reader's language; the
    // store's reason used to be English prose forwarded straight onto the wire.
    if (!result.ok) {
      if (result.reason === "notFound") return jsonRefusal("TEMPLATE_NOT_FOUND", 404);
      return jsonRefusal(result.reason === "last" ? "TEMPLATE_LAST_ONE" : "TEMPLATE_IS_DEFAULT", 400);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeJsonError(error, "api:templates/[id]", "TEMPLATE_DELETE_FAILED");
  }
}
