import net from "node:net";
import { defaultHostLookup, isPrivateAddress, type HostLookup } from "./ats-egress-guard";
import { sendSmtp, type SmtpMessage, type SmtpOutcome } from "./comms-smtp";
import type { SmtpPrivateConfig } from "./comms-smtp-store";

// T6 — the delivery boundary of the SMTP sender: vet the stored host, PIN the address it
// resolved to, and hand one message to the client. Shared by the channel (comms.ts
// SmtpChannel) and the Send test door (POST /api/comms/smtp/test), so the test reaches
// exactly the host a real letter would and nothing a letter would be refused.
//
// SSRF, the same posture as the relay: the host is operator-supplied and the connection
// carries the mailbox password and candidate letters, so it is resolved here, every
// answer must be public, and the client dials THAT address (TLS still checks the name).
// A rebinding name cannot answer publicly to the vet and privately to the dial.

let hostLookup: HostLookup | undefined;
let sendImpl: typeof sendSmtp = sendSmtp;

/** Test seams. Never called by production code. `undefined` restores the default. */
export function setSmtpHostLookupForTests(fn: HostLookup | undefined): void {
  hostLookup = fn;
}
export function setSmtpSendForTests(fn: typeof sendSmtp | undefined): void {
  sendImpl = fn ?? sendSmtp;
}

/** The address to dial, or a refusal sentence (operator vocabulary, no secret). */
export async function vetSmtpHost(host: string): Promise<{ address: string } | { refused: string }> {
  if (net.isIP(host)) return { refused: `smtp host "${host}" is an IP address; use the server's name` };
  let results: Array<{ address: string }>;
  try {
    results = await (hostLookup ?? defaultHostLookup)(host);
  } catch {
    return { refused: `smtp host "${host}" could not be resolved` };
  }
  if (results.length === 0) return { refused: `smtp host "${host}" did not resolve to any address` };
  for (const { address } of results) {
    if (isPrivateAddress(address)) return { refused: `smtp host "${host}" resolves to a non-public address (${address})` };
  }
  return { address: results[0].address };
}

/** One message over the stored sender. A host refusal is a permanent failure at
 *  `connect` with no reply code; nothing is dialled. */
export async function deliverOverSmtp(cfg: SmtpPrivateConfig, message: SmtpMessage): Promise<SmtpOutcome> {
  const vetted = await vetSmtpHost(cfg.host);
  if ("refused" in vetted) return { ok: false, stage: "connect", code: null, text: vetted.refused, permanent: true };
  return sendImpl(
    {
      host: cfg.host,
      port: cfg.port,
      security: cfg.security,
      username: cfg.address,
      password: cfg.password,
      dialAddress: vetted.address,
    },
    message
  );
}
