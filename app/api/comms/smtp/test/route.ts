import { NextRequest, NextResponse } from "next/server";
import { SEALED } from "@/app/_lib/egress-seal";
import { sendSmtpTestLetter } from "@/app/_lib/comms-smtp-probe";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireOrgCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { withSession } from "@/app/_lib/auth/workspace-context";

// T6 — Send test: one real letter from the stored mailbox to the SAME mailbox (the
// operator's own address), answered with the real SMTP outcome: the stage and the
// server's reply code and text, or the refusal. Never a pretend success: `ok` is true
// only on 250 after DATA. Single attempt, no retry (a probe should answer fast).
//
// Gated and throttled exactly like the relay probe: every accepted call spends a real
// connection from this deployment's address to a host the caller can re-point.
const SMTP_TEST_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

export const POST = withSession(async (request: NextRequest) => {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("org:manage", requireOrgCapability);
  if (under) return under;
  // AFTER the authority gates and BEFORE the sender is resolved (which decrypts the
  // stored password).
  if (!rateLimit(`comms-smtp-test:${clientIpFrom(request.headers)}`, SMTP_TEST_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  const result = await sendSmtpTestLetter();
  if (result.kind === "sealed") return NextResponse.json({ ok: false, sealed: true, reason: SEALED }, { status: 409 });
  if (result.kind === "unconfigured" || result.kind === "unreadable") {
    return NextResponse.json({ ok: false, reason: result.kind }, { status: 400 });
  }
  const o = result.outcome;
  return NextResponse.json(
    o.ok
      ? { ok: true, to: result.to, code: o.code, text: o.text }
      : { ok: false, to: result.to, stage: o.stage, code: o.code, text: o.text }
  );
});
