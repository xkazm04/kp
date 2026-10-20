// Edge-safe session verification for middleware (Web Crypto — NO node:crypto, so
// it runs in the Edge runtime). Format/secret are IDENTICAL to session.ts, so a
// cookie signed there (node) verifies here (edge): token = `<bodyB64url>.<hmacB64url>`,
// hmac = HMAC-SHA256(KP_SECRET, body).

// The session cookie name lives here (the edge-safe module) so middleware can
// import it without pulling node:crypto in via session.ts. session.ts re-exports it.
export const SESSION_COOKIE = "__Host-kp_session";

// The session lifetime lives here for the same reason the cookie name does: the
// revocation store (session-revocation.ts) derives a row's prune point from it and
// is imported by the proxy gate, which must not drag node:crypto in via session.ts.
// session.ts re-exports it, so every existing `from "./session"` importer is unchanged.
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

// What the gate learns from a cookie. `workspace`/`exp` are the gate's own checks;
// `iat`/`sub`/`op` are carried because the REVOCATION lookup keys on them — the
// principal a revocation names ("this user", "the operator of this workspace") is
// derivable only from signed claims, and the gate is where a revoked cookie has to
// die if it is to die before reaching a handler. Optional because a pre-identity
// cookie carries neither `sub` nor `op`, and `principalFor` has a defined answer
// for that case (see session-revocation.ts).
export type EdgeSession = { workspace: string; exp: number; iat?: number; sub?: string; op?: true };

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function verifySessionEdge(
  token: string | undefined | null,
  secret: string | undefined,
  now: number = Date.now(),
  minEpoch: number = 0
): Promise<EdgeSession | null> {
  if (!token || !secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot >= token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const enc = new TextEncoder();
    const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", k, enc.encode(body));
    const expected = bytesToB64url(mac);
    // Length-then-xor compare (Edge has no timingSafeEqual).
    if (expected.length !== sig.length) return null;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    if (diff !== 0) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body))) as {
      workspace?: unknown;
      exp?: unknown;
      epoch?: unknown;
      iat?: unknown;
      sub?: unknown;
      op?: unknown;
    };
    // Half-open window `[iat, exp)`, IDENTICAL to session.ts (see the comment there for
    // why the boundary is exclusive: it is where this check and the revocation store's
    // `expires_at_ms > now` row predicate have to meet, and `exp < now` missed it by 1 ms).
    if (typeof payload.exp !== "number" || payload.exp <= now) return null;
    if (typeof payload.workspace !== "string" || !payload.workspace) return null;
    // Global kill-switch: a session minted before the current KP_SESSION_EPOCH is dead
    // (a missing epoch is treated as 0 — backward-compatible with pre-epoch tokens).
    if ((typeof payload.epoch === "number" ? payload.epoch : 0) < minEpoch) return null;
    const out: EdgeSession = { workspace: payload.workspace, exp: payload.exp };
    // Carried for the revocation lookup, and NARROWED to the shapes the signer
    // writes — `op` is the privilege marker, so accepting any truthy value here
    // would let a claim like `"op": "no"` name the operator's principal.
    if (typeof payload.iat === "number") out.iat = payload.iat;
    if (typeof payload.sub === "string" && payload.sub) out.sub = payload.sub;
    if (payload.op === true) out.op = true;
    return out;
  } catch {
    return null;
  }
}
