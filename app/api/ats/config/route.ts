import { NextRequest, NextResponse } from "next/server";
import { AtsConfigError, getAtsConfig, setAtsConfig } from "@/app/_lib/ats-config-store";
import { requireOperator } from "@/app/_lib/auth/require-operator";


// P1-5 — read / update the outbound-webhook integration config. The GET never
// returns the signing secret (only `hasSecret`); see the secret doctrine in
// ats-config-store.ts.
//
// AUTHORIZATION — this re-points ALL candidate-PII egress and holds the HMAC
// signing secret, so it is OPERATOR-only (requireOperator, defense-in-depth beyond
// the coarse proxy session gate — the same primitive that guards the whole-DB
// export the secret must never leak through, and the automation/decisions routes).
// Authentication alone (any valid session) is NOT authorization here: without this,
// any org member could re-point the webhook to exfiltrate PII or clear the secret so
// deliveries go unsigned. Open mode (no KP_OPERATOR_PASSWORD) stays open for local dev.
export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  return NextResponse.json({ config: getAtsConfig() });
}

export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const body = (await request.json()) as { webhookUrl?: unknown; webhookSecret?: unknown; events?: unknown };
    const config = setAtsConfig(body);
    return NextResponse.json({ ok: true, config });
  } catch (error) {
    if (error instanceof AtsConfigError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save config." }, { status: 500 });
  }
}
