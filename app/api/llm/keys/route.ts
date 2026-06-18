import { NextRequest, NextResponse } from "next/server";
import { deleteProviderKey } from "@/app/_lib/db";
import { isKeyableProvider, isLlmProvider, KEYABLE_PROVIDERS, listProviderKeyMeta, saveProviderKey } from "@/app/_lib/llm-config";
import { requireOperator } from "@/app/_lib/auth/require-operator";

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
  const denied = await requireOperator();
  if (denied) return denied;
  return NextResponse.json({ keys: listProviderKeyMeta(), providers: KEYABLE_PROVIDERS });
}

export async function PUT(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as {
    provider?: unknown;
    scope?: unknown;
    apiKey?: unknown;
    endpoint?: unknown;
    apiVersion?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  if (!isKeyableProvider(body.provider)) {
    return NextResponse.json(
      { error: "Unknown provider.", providers: KEYABLE_PROVIDERS },
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
  const denied = await requireOperator();
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { provider?: unknown; scope?: unknown } | null;
  if (!body || !isLlmProvider(body.provider)) {
    return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
  }
  const removed = deleteProviderKey(body.provider, isScope(body.scope) ? body.scope : "byom");
  return NextResponse.json({ ok: true, removed, keys: listProviderKeyMeta() });
}
