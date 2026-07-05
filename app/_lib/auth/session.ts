import { createHmac, timingSafeEqual } from "node:crypto";

// Auth & identity foundation (P2 prerequisite). A stateless, signed session token
// for the operator: `<payloadB64url>.<hmacB64url>`, HMAC-SHA256 over KP_SECRET.
// Verified both here (node, route handlers) and in middleware (Edge, via
// edge-verify.ts using the IDENTICAL format/secret). `workspace` is the tenancy
// seam — a single default today; real multi-tenancy will mint per-tenant sessions.

// Cookie name is single-sourced in the edge-safe module (so middleware can use it
// without dragging node:crypto into the Edge bundle); re-exported here for handlers.
export { SESSION_COOKIE } from "./edge-verify.ts";
// Matches billing's single-workspace id (`const WORKSPACE = "workspace"`).
export const DEFAULT_WORKSPACE = "workspace";
// The isolated workspace minted by the public guided-demo entry (`/api/demo`). A
// demo session is a valid signature but is NOT an operator: it must never satisfy
// an operator-gated route (key writes, billing, whole-DB export/import). Single-
// sourced here so the demo route and the operator gate agree on the id.
export const DEMO_WORKSPACE = "demo";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export type SessionPayload = {
  workspace: string;
  iat: number;
  exp: number;
  epoch?: number;
  // Identity (P0): the signed-in user (`sub`), their org, and their role on
  // `workspace`. ABSENT on operator-password and demo sessions (no per-user
  // identity) — so pre-P0 cookies keep verifying unchanged.
  sub?: string;
  org?: string;
  role?: string;
};

/** Optional identity claims stamped into a per-user session at login. */
export type SessionClaims = { sub?: string; org?: string; role?: string };

function key(): string {
  const s = process.env.KP_SECRET;
  if (!s) throw new Error("KP_SECRET is not set — required to sign sessions.");
  return s;
}

function hmac(data: string): string {
  return createHmac("sha256", key()).update(data).digest("base64url");
}

/** A global session-invalidation epoch from KP_SESSION_EPOCH (default 0). A session
 *  is valid only while its epoch >= the current one, so BUMPING the env var revokes
 *  every issued session at once — a kill-switch that does NOT require rotating
 *  KP_SECRET (which also encrypts stored provider keys). The edge gate (proxy.ts /
 *  edge-verify.ts) enforces the same check. Per-session logout-revocation still needs
 *  a server-side store (deferred). */
export function sessionEpoch(): number {
  const n = Number.parseInt(process.env.KP_SESSION_EPOCH ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function signSession(workspace: string = DEFAULT_WORKSPACE, now: number = Date.now(), claims: SessionClaims = {}): string {
  const payload: SessionPayload = { workspace, iat: now, exp: now + SESSION_TTL_MS, epoch: sessionEpoch() };
  // Identity claims (P0) — omitted when absent so operator/demo tokens stay compact
  // and the edge verifier (which only reads workspace/exp/epoch) is unaffected.
  if (claims.sub) payload.sub = claims.sub;
  if (claims.org) payload.org = claims.org;
  if (claims.role) payload.role = claims.role;
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${hmac(body)}`;
}

/** Verify a session token: signature recomputes under KP_SECRET AND not expired.
 *  Returns the payload or null on any failure (tamper, bad secret, expiry, garbage). */
export function verifySession(token: string | undefined | null, now: number = Date.now()): SessionPayload | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot >= token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expected: string;
  try {
    expected = hmac(body);
  } catch {
    return null; // KP_SECRET unset → cannot verify → unauthenticated
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < now) return null;
    if (typeof payload.workspace !== "string" || !payload.workspace) return null;
    // Global kill-switch: reject a session minted before the current epoch (a missing
    // epoch counts as 0 — backward-compatible with pre-epoch tokens).
    if ((payload.epoch ?? 0) < sessionEpoch()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** The tenancy seam: the workspace a request belongs to. Today there is one
 *  default workspace; real multi-tenancy will resolve it from the session. */
export function currentWorkspaceId(session: SessionPayload | null | undefined): string {
  return session?.workspace ?? DEFAULT_WORKSPACE;
}

/** The signed-in user id, or null on an operator/demo/anonymous session. */
export function currentUserId(session: SessionPayload | null | undefined): string | null {
  return session?.sub ?? null;
}

/** The signed-in user's org id, or null when the session carries no identity. */
export function currentOrgId(session: SessionPayload | null | undefined): string | null {
  return session?.org ?? null;
}
