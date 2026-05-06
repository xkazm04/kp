import { NextResponse } from "next/server";
import { loadJd } from "@/app/_lib/db";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  try {
    const row = loadJd(slug);
    if (!row) {
      return NextResponse.json({ error: "JD not found." }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load JD.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
