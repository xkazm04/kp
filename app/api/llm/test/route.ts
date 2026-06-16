import { NextRequest, NextResponse } from "next/server";
import { buildLlmConfigEnv } from "@/app/_lib/llm-config";
import { isLlmUseCase, LLM_USE_CASES } from "@/app/_lib/llm-config";
import { parsePythonJson, spawnPython } from "@/app/_lib/python-runner";

export const runtime = "nodejs";
export const maxDuration = 90;

// Models admin "Test" button: one canary completion through the REAL
// resolution path (KP_LLM_CONFIG → registry → adapter), so a saved pin is
// proven with the exact code production runs — keys, capability checks,
// retries and all. The verdict is the payload (200 either way); only a broken
// spawn is a 500.

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { useCase?: unknown } | null;
  if (!body || !isLlmUseCase(body.useCase) || body.useCase === "*") {
    return NextResponse.json({ error: "Unknown useCase.", useCases: LLM_USE_CASES }, { status: 400 });
  }
  try {
    const { result } = spawnPython(["-m", "pipeline.jobfit.llm.test_cli", "--use-case", body.useCase], {
      signal: request.signal,
      timeoutMs: 90_000,
      env: buildLlmConfigEnv(),
    });
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      return NextResponse.json({ ok: false, error: stderr.trim().slice(-300) || `exit ${exitCode}` });
    }
    return NextResponse.json(parsePythonJson<Record<string, unknown>>(stdout, stderr));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Canary test failed." },
      { status: 500 }
    );
  }
}
