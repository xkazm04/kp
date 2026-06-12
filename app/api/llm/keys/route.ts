import { NextRequest, NextResponse } from "next/server";
import { deleteProviderKey } from "@/app/_lib/db";
import { isLlmProvider, listProviderKeyMeta, LLM_PROVIDERS, saveProviderKey } from "@/app/_lib/llm-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Provider key store (BYOM + hosted-platform keys), headless-first. Secrets are
// write-only: GET returns metadata, never key material. Saving requires
// KP_SECRET (keys are AES-256-GCM encrypted at rest — see llm-secret.ts); a
// missing secret is a 400 with the fix in the message, not a plaintext write.

function isScope(value: unknown): value is "byom" | "platform" {
  return value === "byom" || value === "platform";
}

export async function GET() {
  return NextResponse.json({ keys: listProviderKeyMeta(), providers: LLM_PROVIDERS });
}

export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    provider?: unknown;
    scope?: unknown;
    apiKey?: unknown;
    endpoint?: unknown;
    apiVersion?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  if (!isLlmProvider(body.provider) || body.provider === "claude_cli") {
    return NextResponse.json(
      { error: "Unknown provider.", providers: LLM_PROVIDERS.filter((p) => p !== "claude_cli") },
      { status: 400 }
    );
  }
  if (typeof body.apiKey !== "string" || !body.apiKey.trim()) {
    return NextResponse.json({ error: "apiKey is required." }, { status: 400 });
  }
  const scope = isScope(body.scope) ? body.scope : "byom";
  const endpoint = typeof body.endpoint === "string" && body.endpoint.trim() ? body.endpoint.trim() : undefined;
  if (body.provider === "azure_openai" && !endpoint) {
    return NextResponse.json({ error: "Azure OpenAI needs an endpoint (https://<resource>.openai.azure.com)." }, { status: 400 });
  }
  try {
    saveProviderKey({
      provider: body.provider,
      scope,
      apiKey: body.apiKey.trim(),
      endpoint,
      apiVersion: typeof body.apiVersion === "string" && body.apiVersion.trim() ? body.apiVersion.trim() : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to store the key." },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, keys: listProviderKeyMeta() });
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { provider?: unknown; scope?: unknown } | null;
  if (!body || !isLlmProvider(body.provider)) {
    return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
  }
  const removed = deleteProviderKey(body.provider, isScope(body.scope) ? body.scope : "byom");
  return NextResponse.json({ ok: true, removed, keys: listProviderKeyMeta() });
}
