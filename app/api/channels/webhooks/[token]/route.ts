import { NextResponse } from "next/server";
import { revokeChannelWebhook } from "@/app/_lib/db";


// E3 — revoke an inbound webhook. The row (and its receipt history) is kept for
// audit; the public receiver answers 404 for a revoked token from then on.
export async function DELETE(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const revoked = revokeChannelWebhook(token);
  if (!revoked) return NextResponse.json({ error: "Webhook not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
