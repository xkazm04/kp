import { NextRequest, NextResponse } from "next/server";
import { getDevCase } from "@/app/_lib/db";
import { getAdapter } from "@/app/_lib/distribution";

export const runtime = "nodejs";

// OUT: publish an approved role+case through a distribution channel (local stub by default).
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { caseId?: string; channel?: string };
    if (!body.caseId) return NextResponse.json({ error: "caseId is required." }, { status: 400 });
    const devCase = getDevCase(body.caseId);
    if (!devCase) return NextResponse.json({ error: "case not found" }, { status: 404 });
    const posting = await getAdapter(body.channel ?? "local").publish(devCase);
    return NextResponse.json({ posting });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Publish failed." }, { status: 500 });
  }
}
