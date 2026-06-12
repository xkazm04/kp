import { NextRequest, NextResponse } from "next/server";
import { deleteLlmConfig, listLlmConfig, upsertLlmConfig } from "@/app/_lib/db";
import { isLlmProvider, isLlmUseCase, LLM_PROVIDERS, LLM_USE_CASES } from "@/app/_lib/llm-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Models admin API, headless-first (docs/LLM_PROVIDER_LAYER.md): pin a
// provider/model per use case. GET returns the pins + catalogs; PUT upserts one
// pin; DELETE reverts a use case to the built-in default (Claude CLI locally).
// The Python registry validates capability fit at resolve time — a bad pin
// fails the next LLM call loudly instead of silently degrading.

export async function GET() {
  return NextResponse.json({
    rows: listLlmConfig(),
    providers: LLM_PROVIDERS,
    useCases: LLM_USE_CASES,
  });
}

export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    useCase?: unknown;
    provider?: unknown;
    model?: unknown;
    params?: unknown;
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
  upsertLlmConfig({ useCase: body.useCase, provider: body.provider, model, params });
  return NextResponse.json({ ok: true, rows: listLlmConfig() });
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { useCase?: unknown } | null;
  if (!body || !isLlmUseCase(body.useCase)) {
    return NextResponse.json({ error: "Unknown useCase.", useCases: LLM_USE_CASES }, { status: 400 });
  }
  const removed = deleteLlmConfig(body.useCase);
  return NextResponse.json({ ok: true, removed, rows: listLlmConfig() });
}
