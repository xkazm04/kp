import { NextResponse } from "next/server";
import { emailInboundDomain, isRelayConfigured } from "@/app/_lib/comms-truth";


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
export function GET() {
  return NextResponse.json({ relayConfigured: isRelayConfigured(), emailInboundDomain: emailInboundDomain() });
}
