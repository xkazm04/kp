import { NextRequest, NextResponse } from "next/server";
import { buildProviderKeyProbeEnv, isKeyableProvider, providerNeedsExplicitModel } from "@/app/_lib/llm-config";
import { spawnPython } from "@/app/_lib/python-runner";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { extractConfigKeys, scrubKeyMaterial, shapeVerdict } from "../../test/verdict.ts";

export const maxDuration = 90;

// Keys panel "Test" button: prove ONE stored credential with a hello-world
// completion through the real adapter, before any use case is pinned to it.
//
// This is a different question from /api/llm/test, which canaries a use case's
// ROUTING. A key can be perfectly valid while nothing routes to its provider —
// which is the normal state right after saving one — so the routing canary
// cannot answer "did I paste the right key". Hence a separate endpoint with a
// provider-scoped env (buildProviderKeyProbeEnv): no routing table, and only the
// (provider, scope) row being asked about, so a platform-row test can never be
// silently answered by the BYOM key that outranks it.
//
// Same safety contract as the routing canary: the verdict IS the payload (200
// either way), and raw provider/SDK text NEVER reaches the client — shapeVerdict
// maps the error class to a stable code and scrubs residual key bytes.

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { provider?: unknown; scope?: unknown; model?: unknown } | null;
  const provider = body?.provider;
  const scope = body?.scope === "platform" ? "platform" : "byom";
  if (!isKeyableProvider(provider)) {
    return NextResponse.json({ error: "Unknown or keyless provider.", code: "unknown_provider" }, { status: 400 });
  }
  const model = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : null;
  // A customer-named deployment / slug provider has nothing to guess. Say so as a
  // verdict the panel can act on (reveal the model field) rather than firing a
  // request that can only come back as a generic `invalid_model`.
  if (!model && providerNeedsExplicitModel(provider)) {
    return NextResponse.json({ ok: false, code: "model_required", error: "This provider needs an explicit model." });
  }

  const configEnv = buildProviderKeyProbeEnv(provider, scope);
  if (!configEnv) {
    return NextResponse.json({ error: "No stored key for that provider and scope.", code: "not_found" }, { status: 404 });
  }
  const configKeys = extractConfigKeys(configEnv);

  try {
    const { result } = spawnPython(
      ["-m", "pipeline.jobfit.llm.test_cli", "--provider", provider, ...(model ? ["--model", model] : [])],
      { signal: request.signal, timeoutMs: 90_000, env: configEnv }
    );
    const { stdout, stderr, exitCode } = await result;
    const verdict = shapeVerdict({ stdout, stderr, exitCode }, configKeys);
    if (!verdict.ok) {
      console.error(`[llm/keys/test] probe failed (exit ${exitCode}) for ${provider}:${scope}:`, {
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
        code: "provider_error",
        error: scrubKeyMaterial(error instanceof Error ? error.message : "Key probe failed.", configKeys),
      },
      { status: 500 }
    );
  }
}
