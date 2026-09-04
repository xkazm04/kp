import { NextRequest, NextResponse } from "next/server";
import { AtsConfigError, AtsConfigStaleError, getAtsConfig, setAtsConfig } from "@/app/_lib/ats-config-store";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireOrgCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";


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
  // AUTHORIZATION (write-routes-check-a-capability). requireOperator above proves a
  // session, not authority. This door rewrites INSTALLATION-level configuration,
  // so it is an org-administration act: `org:manage`, resolved org-wide, which
  // recruiters and viewers do not hold.
  const under = await requireCapabilityCoded("org:manage", requireOrgCapability);
  if (under) return under;
  try {
    const body = (await request.json()) as {
      webhookUrl?: unknown;
      webhookSecret?: unknown;
      events?: unknown;
      expectedVersion?: unknown;
    };
    // `expectedVersion` is the version the panel READ (GET's `config.version`). The write
    // is a PARTIAL update now, but the two fields it does carry are still a replace, so
    // without this a second tab (or a second operator) silently dropped the event
    // subscriptions the first had just saved. The store re-asserts it under the write lock.
    const config = setAtsConfig(body);
    return NextResponse.json({ ok: true, config });
  } catch (error) {
    // Checked FIRST: a stale write subclasses AtsConfigError, and it is a refusal (409,
    // nothing written), not a validation failure. The CURRENT config rides along so the
    // panel can offer "reload and re-apply" against what is actually stored.
    if (error instanceof AtsConfigStaleError) {
      return jsonRefusal("ATS_CONFIG_STALE", 409, { config: getAtsConfig() });
    }
    if (error instanceof AtsConfigError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // A thrown better-sqlite3 / crypto error carries the db path and internal detail: it
    // goes to the server log, and the client gets the code it can render in its own
    // language. This used to forward `error.message` verbatim on the 500.
    return safeJsonError(error, "api:ats/config", "ATS_CONFIG_SAVE_FAILED");
  }
}
