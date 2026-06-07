import { NextResponse } from "next/server";
import { loadJd } from "@/app/_lib/db";
import { safeJsonError } from "@/app/_lib/api-response";

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
    return safeJsonError(error, "api:jds/[slug]", "JD_LOAD_FAILED");
  }
}
