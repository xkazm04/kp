import { NextRequest, NextResponse } from "next/server";
import { listDevCases, saveDevCase } from "@/app/_lib/db";

export const runtime = "nodejs";

// GET: approved case scenarios. POST: the human gate — approve a designed role+case.
export async function GET() {
  try {
    return NextResponse.json({ cases: listDevCases() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to list cases." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      need?: unknown;
      analysis?: unknown;
      role?: Record<string, unknown>;
      case?: Record<string, unknown>;
    };
    if (!body.role || !body.case) {
      return NextResponse.json({ error: "role and case are required to approve." }, { status: 400 });
    }
    const saved = saveDevCase({
      need: body.need ?? null,
      analysis: body.analysis ?? null,
      role: body.role,
      case: body.case,
    });
    return NextResponse.json({ ok: true, ...saved });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Approve failed." }, { status: 500 });
  }
}
