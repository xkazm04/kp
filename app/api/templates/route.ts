import { NextRequest, NextResponse } from "next/server";
import { createTemplate, listTemplates } from "@/app/_lib/templates-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ templates: listTemplates() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load templates." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { name?: string; body?: string };
    if (!body.name || !body.body) return NextResponse.json({ error: "name and body are required." }, { status: 400 });
    return NextResponse.json({ template: createTemplate({ name: body.name, body: body.body }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Create failed." }, { status: 500 });
  }
}
