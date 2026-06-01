import { NextRequest, NextResponse } from "next/server";
import { deleteTemplate, getTemplate, setDefaultTemplate, updateTemplate } from "@/app/_lib/templates-store";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const template = getTemplate(id);
  if (!template) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  return NextResponse.json({ template });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as { name?: string; body?: string; isDefault?: boolean };
    // Promote-to-default is a distinct, single-row state change (clears the flag
    // on every other template), kept separate from a name/body edit.
    const template = body.isDefault === true ? setDefaultTemplate(id) : updateTemplate(id, body);
    if (!template) return NextResponse.json({ error: "Template not found." }, { status: 404 });
    return NextResponse.json({ template });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed." }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = deleteTemplate(id);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
  return NextResponse.json({ ok: true });
}
