import { getRelayConfig, getRelaySecret } from "./comms-relay-store";

// THE capability bit for outbound comms delivery — resolved env → stored config
// → nothing. Replaces the env-only comms-truth.isRelayConfigured now that the
// relay is UI-configurable (RelayConfigCard on the Channels tab): every "sent"
// claim, the channel selection (comms.ts), and the Comms Center banner key off
// this one resolver, so the honesty vocabulary can't drift from what actually
// delivers. Server-only (reads the DB); client surfaces keep getting the bit
// over /api/comms/capability. Env keeps precedence so existing deploys with
// COMMS_WEBHOOK_URL behave exactly as before.

export type ResolvedRelay = { url: string; secret: string | null; source: "env" | "config" };

export function resolveRelay(): ResolvedRelay | null {
  const envUrl = process.env.COMMS_WEBHOOK_URL;
  if (envUrl) return { url: envUrl, secret: null, source: "env" };
  try {
    const cfg = getRelayConfig();
    if (cfg.url) return { url: cfg.url, secret: getRelaySecret(), source: "config" };
  } catch {
    // A misconfigured store (e.g. undecryptable secret) must not take every
    // capability read down — treat as unconfigured; the send path will surface
    // the real error when it tries to sign.
    return null;
  }
  return null;
}

/** Is a real delivery relay wired? (See resolveRelay for precedence.) */
export function isRelayConfigured(): boolean {
  return resolveRelay() !== null;
}
