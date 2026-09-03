import { NextRequest, NextResponse } from "next/server";
import { deleteProviderKey } from "@/app/_lib/db/llm";
import {
  isKeyableProvider,
  isKeylessProvider,
  isLlmProvider,
  KEYABLE_PROVIDERS,
  listProviderKeyMeta,
  providerAcceptsBaseUrl,
  saveProviderKey,
} from "@/app/_lib/llm-config";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireOrgCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal } from "@/app/_lib/api-response";


// Provider key store (BYOM + hosted-platform keys), headless-first. Secrets are
// write-only: GET returns metadata, never key material. Saving requires
// KP_SECRET (keys are AES-256-GCM encrypted at rest — see llm-secret.ts); a
// missing secret is a 400 with its OWN code, so the panel can state the fix in
// the operator's language instead of sniffing an English substring.
//
// AUTHORITY. Listing key metadata is operator-gated; WRITING or DELETING one is
// `org:manage`. A stored key is the deployment's spending credential and, on a
// self-hosted install, the platform key every model call runs on — replacing it
// re-points that spend, and deleting it stops the product working. That is an
// owner act, not something every seat holds; `requireOperator()` alone admits any
// non-demo session. Open dev mode and an operator-password session both fold to
// owner inside callerOrgCapabilities, so a single-operator install is unchanged.
//
// SCOPE. This store is DEPLOYMENT-WIDE, not per tenant: `provider_keys` is keyed
// (provider, scope) with no org/workspace column, so a key saved here is used by
// every workspace on this install. The panel says so out loud (models.keys.storeScope).

/** 403 + a machine code for a signed-in caller who is not an owner; the plain 401
 *  when there is no session at all. Null = proceed. */
async function requireModelAdmin(): Promise<NextResponse | null> {
  const denied = await requireOrgCapability("org:manage");
  if (!denied) return null;
  if (denied.status === 401) return denied;
  return jsonRefusal("MODEL_ADMIN_FORBIDDEN", 403);
}

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
  const underPrivileged = await requireModelAdmin();
  if (underPrivileged) return underPrivileged;
  const body = (await request.json().catch(() => null)) as {
    provider?: unknown;
    scope?: unknown;
    apiKey?: unknown;
    endpoint?: unknown;
    apiVersion?: unknown;
    baseUrl?: unknown;
  } | null;
  if (!body) return jsonRefusal("MODEL_KEY_BODY_INVALID", 400);
  if (!isKeyableProvider(body.provider)) {
    // The provider list rides beside the code as DATA — the reader's own sentence
    // never needed the server's English to carry it.
    return jsonRefusal("MODEL_KEY_PROVIDER_UNKNOWN", 400, { providers: KEYABLE_PROVIDERS });
  }
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const baseUrl =
    providerAcceptsBaseUrl(body.provider) && typeof body.baseUrl === "string" && body.baseUrl.trim()
      ? body.baseUrl.trim()
      : undefined;
  // A KEYLESS provider (a stock Ollama / llama.cpp / LM Studio server checks no
  // credential) may be saved with a base URL and no key — that row exists to say
  // WHERE the model server is. Every other provider still requires a key, and even
  // a keyless one must carry at least one of the two, or the row says nothing.
  if (!apiKey && !(isKeylessProvider(body.provider) && baseUrl)) {
    return jsonRefusal(
      isKeylessProvider(body.provider) ? "MODEL_KEY_LOCATION_REQUIRED" : "MODEL_KEY_SECRET_REQUIRED",
      400,
      { provider: body.provider }
    );
  }
  const scope = isScope(body.scope) ? body.scope : "byom";
  const endpoint = typeof body.endpoint === "string" && body.endpoint.trim() ? body.endpoint.trim() : undefined;
  if (body.provider === "azure_openai" && !endpoint) {
    return jsonRefusal("MODEL_KEY_ENDPOINT_REQUIRED", 400, { provider: body.provider });
  }
  // The encryption secret is checked HERE rather than read off the thrown message.
  // The panel used to detect this case with `error.includes("KP_SECRET")` — an
  // English substring on a string the client is not supposed to render at all —
  // so the one 400 whose fix is a server-side env var had no machine signal.
  if (!process.env.KP_SECRET) {
    return jsonRefusal("MODEL_KEY_ENCRYPTION_UNCONFIGURED", 400, { provider: body.provider });
  }
  try {
    // Awaited: saveProviderKey now RESOLVES the endpoint host (DNS-rebind guard),
    // so an invalid/private-resolving endpoint rejects here and maps to a 400.
    await saveProviderKey({
      provider: body.provider,
      scope,
      apiKey,
      endpoint,
      apiVersion: typeof body.apiVersion === "string" && body.apiVersion.trim() ? body.apiVersion.trim() : undefined,
      baseUrl,
    });
  } catch (error) {
    // The thrown message names the resolved host, the rejected URL or the crypto
    // helper's detail — operator detail for the server log, never the wire. The
    // caller gets one code whose remedy ("check the endpoint / server URL") is the
    // same for every member of the class.
    console.error(`[api:llm/keys] MODEL_KEY_REJECTED for ${String(body.provider)}:${scope}`, error);
    return jsonRefusal("MODEL_KEY_REJECTED", 400, { provider: body.provider });
  }
  return NextResponse.json({ ok: true, keys: listProviderKeyMeta() });
}

export async function DELETE(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const underPrivileged = await requireModelAdmin();
  if (underPrivileged) return underPrivileged;
  const body = (await request.json().catch(() => null)) as { provider?: unknown; scope?: unknown } | null;
  if (!body || !isLlmProvider(body.provider)) {
    return jsonRefusal("MODEL_KEY_PROVIDER_UNKNOWN", 400, { providers: KEYABLE_PROVIDERS });
  }
  const removed = deleteProviderKey(body.provider, isScope(body.scope) ? body.scope : "byom");
  return NextResponse.json({ ok: true, removed, keys: listProviderKeyMeta() });
}
