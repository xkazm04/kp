import { NextRequest, NextResponse } from "next/server";
import { buildLlmConfigEnv } from "@/app/_lib/llm-config";
import { isLlmUseCase, LLM_USE_CASES } from "@/app/_lib/llm-config";
import { spawnPython } from "@/app/_lib/python-runner";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { extractConfigKeys, scrubKeyMaterial, shapeVerdict } from "./verdict.ts";

export const maxDuration = 90;

// THROTTLE (rate-limit-contract.test.ts). Every click here spawns a Python child
// that makes a REAL, billable completion through the pinned provider — the same
// spend shape /api/profile/draft carries a budget for — and this door had none.
// It is operator-gated, but open mode makes that gate a documented no-op for the
// whole API, and on a password-gated deploy any seat satisfies it. 30/10min per
// IP: the Models table is one click per row and holds a couple of dozen rows, so
// an operator proving every pin in one sitting stays under it while a scripted
// loop meets it at once.
const CANARY_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };

// Models admin "Test" button: one canary completion through the REAL
// resolution path (KP_LLM_CONFIG → registry → adapter), so a saved pin is
// proven with the exact code production runs — keys, capability checks,
// retries and all. The verdict is the payload (200 either way); only a broken
// spawn is a 500.

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { useCase?: unknown } | null;
  if (!body || !isLlmUseCase(body.useCase) || body.useCase === "*") {
    return NextResponse.json({ error: "Unknown useCase.", useCases: LLM_USE_CASES }, { status: 400 });
  }
  // After the operator gate AND after the unknown-useCase 400: a malformed call
  // costs nothing and must be refused honestly rather than counted as traffic.
  if (!rateLimit(`llm-canary:${clientIpFrom(request.headers)}`, CANARY_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  // Build the config env once so we can also mine the decrypted key bytes out of
  // it for the response scrub backstop (below).
  const configEnv = buildLlmConfigEnv();
  const configKeys = extractConfigKeys(configEnv);
  try {
    const { result } = spawnPython(["-m", "pipeline.jobfit.llm.test_cli", "--use-case", body.useCase], {
      signal: request.signal,
      timeoutMs: 90_000,
      env: configEnv,
    });
    const { stdout, stderr, exitCode } = await result;
    // The canary runs with the decrypted key in env (KP_LLM_CONFIG), and test_cli
    // exits 0 even on failure (the verdict IS the payload) — so raw provider/SDK
    // text can arrive on EITHER path (the exit-0 failure envelope or an exit!=0
    // stderr trace). shapeVerdict never forwards that raw text: it maps the error
    // CLASS to a generic reason and scrubs any residual key bytes. The client only
    // ever sees a safe, mapped reason; the full detail is logged server-side.
    const verdict = shapeVerdict({ stdout, stderr, exitCode }, configKeys);
    if (!verdict.ok) {
      console.error(`[llm/test] canary failed (exit ${exitCode}) for ${String(body.useCase)}:`, {
        code: verdict.code,
        stdout: stdout.trim().slice(-2000),
        stderr: stderr.trim().slice(-2000),
      });
    }
    return NextResponse.json(verdict);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: scrubKeyMaterial(error instanceof Error ? error.message : "Canary test failed.", configKeys),
      },
      { status: 500 }
    );
  }
}
