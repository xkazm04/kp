import { NextRequest, NextResponse } from "next/server";
import { ReasoningError, runReasoning, type ReasoningInput } from "@/app/_lib/reasoning-run";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { getServerLocale } from "@/i18n/server";
import { isLocale } from "@/i18n/locales";


// Synchronous convenience wrapper. The hardened/background path is /api/tasks
// with kind "reasoning" (tracked, dedup'd, refresh-safe); both share runReasoning.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ReasoningInput;
    // MAT1 — default the narrative locale to the request's locale when the body
    // didn't pin one (the task path passes the client's active locale directly).
    const lang = isLocale(body.lang) ? body.lang : await getServerLocale();
    const data = await runReasoning({ ...body, lang }, undefined, await currentWorkspace());
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof ReasoningError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Reasoning failed." }, { status: 500 });
  }
}
