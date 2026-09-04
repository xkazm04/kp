import { NextResponse } from "next/server";
import { emailInboundDomain } from "@/app/_lib/comms-truth";
import { isRelayConfigured } from "@/app/_lib/comms-relay";
import { requireOperator } from "@/app/_lib/auth/require-operator";


// REC-10 — the comms capability bits, served tiny so any client surface that
// renders a delivery claim can read them without dragging the full /api/comms
// payload (see useDeliveryCapability). Both directions of the channel:
//
//   relayConfigured    — is a real OUTBOUND relay wired (COMMS_WEBHOOK_URL), or is
//                        every "send" a terminal `queued` row in the local outbox?
//   emailInboundDomain — the INBOUND twin (inbound-setup-honesty): the domain a
//                        configured inbound-email provider routes to a receiver
//                        token, or null when email forwarding isn't wired at all
//                        and the only real receiver is the HTTP endpoint. The Email
//                        intake wizard used to synthesize an address from
//                        window.location; a mail route is a deployment fact, so it
//                        can only come from the server.
//
// SESSION-GATED (/perfect wave 27, api-comms). This read was the one door in the comms
// area with no auth of any kind — and it is not a null answer: it states whether this
// deployment relays candidate mail at all, and NAMES the inbound mail domain the
// operator wired up. Both are deployment facts about the installation, and the second
// is a live address. On a gated deploy the proxy already covered it; on any deploy it
// was reachable by an anonymous demo cookie, which is exactly the caller with no
// business knowing the mail wiring. requireOperator, like the relay-config door beside
// it: open mode allows (documented, whole-API), a demo session does not.
//
// PROJECTION, not the resolver's record: the response is these two bits and nothing
// else. `resolveRelay()` also holds the relay URL and its decrypted signing secret —
// this handler must never grow into returning them.
export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  // A refused read reaches useCommsCapability as a non-2xx, which it already folds to
  // the UNKNOWN record: `relayConfigured: null` keeps every surface on its existing
  // copy and `emailInboundDomain: null` shows the honest not-wired state. No consumer
  // renders an error for this route, so the gate needs no new refusal vocabulary.
  return NextResponse.json({ relayConfigured: isRelayConfigured(), emailInboundDomain: emailInboundDomain() });
}
