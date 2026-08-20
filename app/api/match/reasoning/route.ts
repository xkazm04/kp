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
    // Forward the request's abort signal (same contract as /api/match and
    // /api/matrix): an abandoned request SIGKILLs the reasoning child instead of
    // orphaning an LLM-backed subprocess to python-runner's 600s backstop while it
    // holds a temp workdir. Right for THIS route precisely because it is the
    // synchronous wrapper — the survive-navigation path is /api/tasks with kind
    // "reasoning", which passes the TASK's own signal so a refresh doesn't kill it.
    const data = await runReasoning({ ...body, lang }, request.signal, await currentWorkspace());
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof ReasoningError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Reasoning failed." }, { status: 500 });
  }
}
