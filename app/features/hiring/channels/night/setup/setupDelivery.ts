/*
 * Level 1's two delivery editors, as decisions (pure; pinned by setupDelivery.test.ts): the relay
 * (where outbound mail goes) and the always-on edge (who answers while the studio is off). The
 * rules are the retired editors' (ChannelsRelayConfigCard, ChannelsEdgeCard), lifted out of the
 * components so node:test can hold them:
 *
 *  - the POST is a full REPLACE, so a blank URL is a legitimate save only once the stored config is
 *    KNOWN (a blank on a failed read once cleared a live relay and unpaired a working edge);
 *  - a refusal is answered from its CODE (useErrorMessage), never from the server's English prose;
 *  - a drain that failed is a failure by status first, then by the edge's failure CLASS: a 403 that
 *    carries no summary once rendered "Drained: 0 filed" in green;
 *  - the test ping's answer is the truth: 2xx = the relay took it (the product's `sent`), anything
 *    else failed; a refusal is about the caller, not the endpoint. The depot's shutter rolls up only
 *    after that answer, never from what a URL looks like.
 */
import type { EdgeErrorKind } from "@/app/_lib/edge-config.ts";
import type { Condition } from "@/app/_components/kit/scene/conditions.ts";
import type { EdgeState, RelayState } from "../channelsNightReads.ts";

type Coded = { code?: string | null };

/* ------------------------------------------------------------------ relay */

/** A relay is active when the env var or a stored URL carries it (unknown = not active). */
export function relayActive(state: RelayState | null): boolean {
  return state ? state.envConfigured || state.url.trim() !== "" : false;
}

/** The field differs from what is stored (or anything was typed before the read landed). */
export function relayDirty(state: RelayState | null, url: string, secret: string): boolean {
  return secret !== "" || url.trim() !== (state?.url ?? "").trim();
}

/** Save may run: not busy, and not a blank over a config nobody read (it would disable the relay). */
export function canSaveRelay(state: RelayState | null, url: string, busy: boolean): boolean {
  return !busy && !(state === null && url.trim() === "");
}

export type RelayTestGate = "ok" | "busy" | "noRelay" | "unreadable" | "unsaved";

/** Why the test ping cannot run (or "ok"): a stored endpoint we cannot sign for is not a relay the
 *  send path would use, and a typed-but-unsaved endpoint is not the one the server would probe. */
export function relayTestGate(state: RelayState | null, dirty: boolean, busy: boolean): RelayTestGate {
  if (busy) return "busy";
  if (!relayActive(state)) return "noRelay";
  if (state?.relay === "unreadable") return "unreadable";
  return dirty ? "unsaved" : "ok";
}

export type RelaySaveBody = { url: string; secret?: string; expectedVersion?: number };

/** The POST body: the secret only when typed (omitted = keep), the version only when it was READ. */
export function relaySaveBody(state: RelayState | null, url: string, secret: string): RelaySaveBody {
  const body: RelaySaveBody = { url: url.trim() };
  if (secret !== "") body.secret = secret;
  if (state) body.expectedVersion = state.version;
  return body;
}

export type RelaySaveOutcome = { kind: "saved" } | { kind: "stale"; body: Coded | null } | { kind: "refused"; body: Coded | null };

/** One POST /api/comms/relay answer. `stale` (409): someone saved a newer config, nothing was
 *  written; the caller adopts the stored one. Both `saved` and `stale` change the capability. */
export function relaySaveOutcome(status: number, body: unknown): RelaySaveOutcome {
  const b = body && typeof body === "object" ? (body as Coded & { config?: unknown }) : null;
  if (status >= 200 && status < 300 && b?.config) return { kind: "saved" };
  return status === 409 ? { kind: "stale", body: b } : { kind: "refused", body: b };
}

export type RelayTest =
  | { kind: "sent"; status: number }
  | { kind: "failed"; reason: string }
  /** `status` is the HTTP status of the refusal, when known: the words when the code has none. */
  | { kind: "refused"; body: Coded; status?: number };

/** One POST /api/comms/relay/test answer (null body = the request never completed); `http` = its status. */
export function relayTestOutcome(body: unknown, http?: number): RelayTest {
  const d = body && typeof body === "object" ? (body as { ok?: boolean; status?: number; reason?: string; code?: string }) : null;
  if (d?.ok) return { kind: "sent", status: d.status ?? 200 };
  if (d?.code) return http ? { kind: "refused", body: { code: d.code }, status: http } : { kind: "refused", body: { code: d.code } };
  if (d === null) return { kind: "failed", reason: "network" };
  return { kind: "failed", reason: d.reason ?? `HTTP ${d.status ?? "?"}` };
}

/** The depot as drawn at level 1: the barrier is up while a readable relay is configured (the
 *  district's own rule), and the shutter rolls up (live) once delivery is proven: sent rows, or
 *  a test ping the relay just answered. */
export function relayScene(plate: Condition, test: RelayTest["kind"] | null): { condition: Condition; gateUp: boolean; answered: boolean } {
  const gateUp = plate === "wait" || plate === "live";
  const answered = gateUp && test === "sent";
  return { condition: answered ? "live" : plate, gateUp, answered };
}

/* ------------------------------------------------------------------ edge */

export type EdgeStatus = "offline" | "paired" | "secretMissing" | "off";

/** PAIRED needs a URL AND a secret (a URL alone drained nothing while it read green). */
export function edgeView(state: EdgeState | null): { hasUrl: boolean; paired: boolean; secretMissing: boolean; status: EdgeStatus | null } {
  const hasUrl = state ? state.envConfigured || state.url.trim() !== "" : false;
  const paired = hasUrl && Boolean(state?.hasSecret);
  const secretMissing = hasUrl && !state?.hasSecret;
  const status: EdgeStatus | null = !state ? null : state.offline ? "offline" : paired ? "paired" : secretMissing ? "secretMissing" : "off";
  return { hasUrl, paired, secretMissing, status };
}

/**
 * The drain ledger's cursor cell: the cursor as a number once the edge was drained, else null
 * ("Never drained"). "Never" is read from the last drain (a cursor that moved counts too), never
 * from a cursor of 0: a drain that applied nothing leaves 0 beside a real "Last drain" date.
 */
export function edgeCursorValue(state: Pick<EdgeState, "cursor" | "lastDrainAt">): string | null {
  return state.lastDrainAt || state.cursor > 0 ? String(state.cursor) : null;
}

export const EDGE_STATUS_KEY = {
  offline: "channels.edge.statusOffline",
  paired: "channels.edge.statusPaired",
  secretMissing: "channels.edge.statusSecretMissing",
  off: "channels.edge.statusOff",
} as const satisfies Record<EdgeStatus, string>;

/** Save may run: not busy, and not a blank over an unread config (unpairing resets the cursor). */
export function canSaveEdge(state: EdgeState | null, url: string, busy: boolean): boolean {
  return !busy && !(state === null && url.trim() === "");
}

export type EdgeSaveBody = { url: string; secret?: string; nudgeTarget: string };

export function edgeSaveBody(url: string, secret: string, nudge: string): EdgeSaveBody {
  const body: EdgeSaveBody = { url: url.trim(), nudgeTarget: nudge.trim() };
  if (secret !== "") body.secret = secret;
  return body;
}

export type DrainOutcome =
  | { kind: "drained"; applied: number; skipped: number }
  | { kind: "failed"; errorKind: EdgeErrorKind }
  | { kind: "refused"; body: Coded | null };

/** One POST /api/edge/drain answer. Status FIRST: a refusal (403, 500) carries no summary and must
 *  never read as a quiet queue. A failure the edge classified is reported by its class. */
export function drainOutcome(ok: boolean, body: unknown): DrainOutcome {
  const d = body && typeof body === "object" ? (body as Coded & { summary?: { applied?: number; skipped?: number; error?: string | null; errorKind?: EdgeErrorKind | null } }) : null;
  const kind = d?.summary?.errorKind;
  if (!ok || d?.summary?.error) return kind ? { kind: "failed", errorKind: kind } : { kind: "refused", body: d };
  return { kind: "drained", applied: d?.summary?.applied ?? 0, skipped: d?.summary?.skipped ?? 0 };
}
