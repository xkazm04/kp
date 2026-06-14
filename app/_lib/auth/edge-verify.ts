// Edge-safe session verification for middleware (Web Crypto — NO node:crypto, so
// it runs in the Edge runtime). Format/secret are IDENTICAL to session.ts, so a
// cookie signed there (node) verifies here (edge): token = `<bodyB64url>.<hmacB64url>`,
// hmac = HMAC-SHA256(KP_SECRET, body).

// The session cookie name lives here (the edge-safe module) so middleware can
// import it without pulling node:crypto in via session.ts. session.ts re-exports it.
export const SESSION_COOKIE = "__Host-kp_session";

export type EdgeSession = { workspace: string; exp: number };

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
  now: number = Date.now()
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
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body))) as { workspace?: unknown; exp?: unknown };
    if (typeof payload.exp !== "number" || payload.exp < now) return null;
    if (typeof payload.workspace !== "string" || !payload.workspace) return null;
    return { workspace: payload.workspace, exp: payload.exp };
  } catch {
    return null;
  }
}
