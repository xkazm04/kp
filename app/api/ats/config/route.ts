import { NextRequest, NextResponse } from "next/server";
import { AtsConfigError, getAtsConfig, setAtsConfig } from "@/app/_lib/ats-config-store";


// P1-5 — read / update the outbound-webhook integration config. The GET never
// returns the signing secret (only `hasSecret`); see the secret doctrine in
// ats-config-store.ts. Recruiter-admin surface, behind the same proxy auth gate
// as the rest of the recruiter API.
export async function GET() {
  return NextResponse.json({ config: getAtsConfig() });
}

export async function POST(request: NextRequest) {
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
