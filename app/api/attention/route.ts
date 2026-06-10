import { NextResponse } from "next/server";
import { attentionCounts } from "@/app/_lib/attention";
import { safeJsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SHELL2 — the sidebar badge counts. Read-only, tiny payload, polled by the
// shell (mount + live-refresh + a visibility-gated 60s interval).
export async function GET() {
  try {
    return NextResponse.json(attentionCounts());
  } catch (error) {
    return safeJsonError(error, "api:attention", "ATTENTION_FAILED");
  }
}
