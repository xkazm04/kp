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

/**
 * WHY a fourth word exists. A relay whose stored signing secret cannot be
 * DECRYPTED — the deployment secret was rotated, or the DB was restored onto a
 * host with a rebuilt env — used to resolve to the same `null` as "nobody ever
 * configured a relay". Every letter was then honestly recorded `queued`, the
 * Channels card said "Not configured", and the one fact the operator needed —
 * *the endpoint is still there, we just can't sign for it* — existed nowhere but
 * a swallowed exception. `unreadable` is that state, said out loud: on the wire
 * (GET /api/comms/relay), in the card, and once in the server log with the fix.
 */
export type RelayHealth = "env" | "configured" | "unconfigured" | "unreadable";

type Resolution = { relay: ResolvedRelay | null; health: RelayHealth };

// Log-once, keyed by the REASON: a resolver on the send path and on every
// capability read must not turn a broken key into a log flood, but a second,
// different fault is news. Bounded by the number of distinct failure messages
// (in practice one), so it is not a leak.
const loggedReasons = new Set<string>();

function reportUnreadable(reason: string): Resolution {
  if (!loggedReasons.has(reason)) {
    loggedReasons.add(reason);
    console.error(
      `[comms-relay] A relay endpoint is stored but its signing secret cannot be decrypted: ${reason} ` +
        `Outbound candidate messages will keep queueing in the local outbox until this is fixed. ` +
        `Restore the KP_ATS_SECRET_KEY (or KP_SECRET) the secret was stored under, or — if you rotated on purpose — ` +
        `set KP_SECRET_PREVIOUS to the retired one and run \`npm run secrets:rotate\`; ` +
        `otherwise re-enter the signing secret on the Channels tab.`
    );
  }
  // Still NO relay for the send path: POSTing unsigned to an endpoint that
  // verifies `x-kp-signature` would be a "sent" claim the receiver rejects. An
  // honest queue plus a named cause beats a delivery that silently fails.
  return { relay: null, health: "unreadable" };
}

/**
 * THE SEAL. `KP_NO_COMMS_EGRESS=1` makes this resolver answer "no relay" whatever is
 * configured — env URL, stored config, both — so every candidate-facing message queues
 * in the local outbox and is honestly recorded `queued` rather than `sent`.
 *
 * It exists for a process that runs the REAL product code against a COPY of a real
 * database: the goal-1 demo run (scripts/kpi/role-demo-run.mjs) approves interview
 * invites and offers on a scratch copy, and that copy carries the operator's own relay
 * configuration while the process inherits their COMMS_WEBHOOK_URL. No code on that path
 * dispatches today, so nothing has ever been sent — but "no send call exists yet" is a
 * fact about today's call graph, not a guarantee, and the thing on the other end of it is
 * a real person's inbox. This is the guarantee.
 *
 * It is deliberately NOT KP_OFFLINE: that seals ALL egress, including the Claude CLI the
 * simulated interview needs, so a run under it would measure nothing. One flag, one
 * question: may this process speak to a candidate?
 */
export function commsEgressSealed(env: Readonly<Partial<NodeJS.ProcessEnv>> = process.env): boolean {
  return env.KP_NO_COMMS_EGRESS === "1";
}

function resolve(): Resolution {
  // No fifth health word: `RelayHealth` says what DELIVERS, and under the seal nothing
  // does — the same answer, and the same honest `queued` claim, as an install with no
  // relay. The flag is a process-level switch for a demo harness, never a deployment
  // configuration an operator reads off the Channels card.
  if (commsEgressSealed()) return { relay: null, health: "unconfigured" };
  const envUrl = process.env.COMMS_WEBHOOK_URL;
  if (envUrl) return { relay: { url: envUrl, secret: null, source: "env" }, health: "env" };
  let url: string | null;
  try {
    url = getRelayConfig().url;
  } catch (e) {
    // The config row itself is unreadable (a broken store). Not a secret problem,
    // so it keeps the old behaviour — unconfigured — but it is no longer silent.
    console.error(`[comms-relay] Could not read the stored relay config: ${e instanceof Error ? e.message : e}`);
    return { relay: null, health: "unconfigured" };
  }
  if (!url) return { relay: null, health: "unconfigured" };
  try {
    return { relay: { url, secret: getRelaySecret(), source: "config" }, health: "configured" };
  } catch (e) {
    return reportUnreadable(e instanceof Error ? e.message : String(e));
  }
}

export function resolveRelay(): ResolvedRelay | null {
  return resolve().relay;
}

/** What the operator surfaces say about delivery. `unreadable` is the state that
 *  used to masquerade as `unconfigured`; see RelayHealth. */
export function relayHealth(): RelayHealth {
  return resolve().health;
}

/** Is a real delivery relay wired? (See resolveRelay for precedence.) */
export function isRelayConfigured(): boolean {
  return resolveRelay() !== null;
}
