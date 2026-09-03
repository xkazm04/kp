import { NextRequest, NextResponse } from "next/server";
import { deleteLlmConfig, listLlmConfig, upsertLlmConfig } from "@/app/_lib/db/llm";
import { isLlmProvider, isLlmUseCase, LLM_PROVIDERS, LLM_USE_CASES } from "@/app/_lib/llm-config";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireOrgCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal } from "@/app/_lib/api-response";


// Models admin API, headless-first (docs/architecture/llm-provider-layer.md): pin a
// provider/model per use case. GET returns the pins + catalogs; PUT upserts one
// pin; DELETE reverts a use case to the built-in default (Claude CLI locally).
// The Python registry validates capability fit at resolve time — a bad pin
// fails the next LLM call loudly instead of silently degrading.
//
// AUTHORITY. Reading the table is operator-gated; CHANGING it is `org:manage`.
// `requireOperator()` answers "is there a valid session on this deployment?",
// which every recruiter and viewer also satisfies — so re-pointing every model
// call in the product (at a provider whose key the caller controls, or at a
// model that costs ten times as much) was a capability any seat held. Same
// reasoning, and the same helper, as the billing doors: an owner-only act.
//
// Open dev mode (no KP_OPERATOR_PASSWORD) and an operator-password session both
// fold to owner inside callerOrgCapabilities, so a self-hosted single-operator
// install is unchanged.

/** 403 + a machine code for a signed-in caller who is not an owner; the plain 401
 *  when there is no session at all. Null = proceed. */
async function requireModelAdmin(): Promise<NextResponse | null> {
  const denied = await requireOrgCapability("org:manage");
  if (!denied) return null;
  if (denied.status === 401) return denied;
  return jsonRefusal("MODEL_ADMIN_FORBIDDEN", 403);
}

export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  return NextResponse.json({
    rows: listLlmConfig(),
    providers: LLM_PROVIDERS,
    useCases: LLM_USE_CASES,
  });
}

export async function PUT(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const underPrivileged = await requireModelAdmin();
  if (underPrivileged) return underPrivileged;
  const body = (await request.json().catch(() => null)) as {
    useCase?: unknown;
    provider?: unknown;
    model?: unknown;
    params?: unknown;
    expectedUpdatedAt?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  if (!isLlmUseCase(body.useCase)) {
    return NextResponse.json({ error: "Unknown useCase.", useCases: LLM_USE_CASES }, { status: 400 });
  }
  if (!isLlmProvider(body.provider)) {
    return NextResponse.json({ error: "Unknown provider.", providers: LLM_PROVIDERS }, { status: 400 });
  }
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;
  const params =
    body.params && typeof body.params === "object" && !Array.isArray(body.params)
      ? (body.params as Record<string, unknown>)
      : {};
  // The version the caller composed against. A string is the row's `updatedAt` as
  // it was rendered; `null` is "I saw no pin on this use case"; ABSENT is "no
  // opinion" — the headless/curl path, which keeps the old unconditional write.
  const expectedUpdatedAt =
    typeof body.expectedUpdatedAt === "string"
      ? body.expectedUpdatedAt
      : body.expectedUpdatedAt === null
        ? null
        : undefined;
  const written = upsertLlmConfig({ useCase: body.useCase, provider: body.provider, model, params, expectedUpdatedAt });
  if (!written) {
    // Nothing was written: another operator re-pinned this use case after the
    // caller read it. The current rows ride along so the table can reload itself
    // and show what is actually pinned, instead of leaving a stale draft on screen.
    return jsonRefusal("MODEL_ROUTING_STALE", 409, { rows: listLlmConfig() });
  }
  return NextResponse.json({ ok: true, rows: listLlmConfig() });
}

export async function DELETE(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const underPrivileged = await requireModelAdmin();
  if (underPrivileged) return underPrivileged;
  const body = (await request.json().catch(() => null)) as { useCase?: unknown } | null;
  if (!body || !isLlmUseCase(body.useCase)) {
    return NextResponse.json({ error: "Unknown useCase.", useCases: LLM_USE_CASES }, { status: 400 });
  }
  const removed = deleteLlmConfig(body.useCase);
  return NextResponse.json({ ok: true, removed, rows: listLlmConfig() });
}
