import { NextRequest, NextResponse } from "next/server";
import { updateArchetype } from "@/app/_lib/archetype-registry";

export const runtime = "nodejs";

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const result = await updateArchetype(id, body);
    if ("error" in result) {
      const status = result.error === "Archetype not found." ? 404 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update archetype.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
