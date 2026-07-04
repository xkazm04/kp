import { NextResponse } from "next/server";
import { deliver } from "@/app/_lib/ats-egress";


// P1-5 — send a signed `ping` to the configured webhook so an integrator can
// confirm reachability + signature verification before wiring real events. Reports
// the honest delivery result (HTTP status, or the failure reason) — it does NOT
// pretend success when the endpoint 4xx/5xx's or is unreachable.
export async function POST() {
  const result = await deliver("ping", { ping: true });
  if (result.delivered) {
    return NextResponse.json({ ok: true, status: result.status });
  }
  return NextResponse.json({ ok: false, reason: result.reason }, { status: 400 });
}
