import { randomToken } from "../random-id";
import { resolveBridge, markBridgeOk, setBridgeConfig } from "./bridge-store";

// Personas pairing (WP1) — the human-approved key exchange.
//
// Contract (Personas management API): POST {baseUrl}/pair/request registers a
// pending entry keyed by a ≥16-char nonce WE mint (TTL 300s on the Personas
// side); the human approves in the Personas desktop app; GET /pair/claim is
// SINGLE-USE and returns the pk_ key once approved. We therefore split the flow
// into start (mint + register) and claim (one poll attempt) so the recruiter UI
// (WP2) polls claim without holding a long-blocking request open; a successful
// claim stores the key encrypted (bridge-store) and the nonce is spent.
//
// Loopback by design — see bridge-client.ts for why no SSRF guard runs here.

const TIMEOUT_MS = 5_000;
export const PAIRING_SCOPES = ["personas:read", "personas:build"] as const;
const NONCE_TTL_MS = 300_000; // mirrors the Personas-side TTL

// In-process pending nonces (single Next server process — same rationale as
// rate-limit.ts). A restart just means starting a fresh pairing.
const pending = new Map<string, number>(); // nonce -> expiresAt ms

function sweep(now: number): void {
  for (const [n, exp] of pending) if (exp <= now) pending.delete(n);
}

export type PairStartResult = { ok: true; nonce: string; expiresInS: number } | { ok: false; error: string };

/** Phase 1: mint a nonce and register the pairing request with Personas. */
export async function startPairing(): Promise<PairStartResult> {
  const bridge = resolveBridge();
  // randomToken mints prefix + 32 base64url chars — comfortably ≥16 chars of CSPRNG entropy.
  const nonce = randomToken("pairn");
  try {
    const r = await fetch(`${bridge.baseUrl}/pair/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce, scopes: PAIRING_SCOPES, client: "kp" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) return { ok: false, error: `Personas responded ${r.status} to the pairing request.` };
    const now = Date.now();
    sweep(now);
    pending.set(nonce, now + NONCE_TTL_MS);
    return { ok: true, nonce, expiresInS: NONCE_TTL_MS / 1000 };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && e.name === "TimeoutError"
          ? "Personas did not respond within 5s — is the desktop app running?"
          : e instanceof Error
            ? e.message
            : "Could not reach Personas.",
    };
  }
}

export type PairClaimResult =
  | { ok: true; paired: true }
  | { ok: true; paired: false; state: "pending" }
  | { ok: false; error: string };

/** Phase 2: one claim attempt for a nonce startPairing minted. "pending" until
 *  the human approves in Personas; on success the key is stored encrypted and
 *  the claim (single-use on the Personas side) is spent. */
export async function claimPairing(nonce: string): Promise<PairClaimResult> {
  const now = Date.now();
  sweep(now);
  const exp = pending.get(nonce);
  if (!exp || exp <= now) return { ok: false, error: "Unknown or expired pairing nonce — start pairing again." };
  const bridge = resolveBridge();
  try {
    const r = await fetch(`${bridge.baseUrl}/pair/claim?nonce=${encodeURIComponent(nonce)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (r.status === 404 || r.status === 202) return { ok: true, paired: false, state: "pending" };
    if (!r.ok) return { ok: false, error: `Personas responded ${r.status} to the pairing claim.` };
    const body = (await r.json().catch(() => null)) as { apiKey?: unknown; key?: unknown; status?: unknown } | null;
    const key =
      typeof body?.apiKey === "string" && body.apiKey
        ? body.apiKey
        : typeof body?.key === "string" && body.key
          ? body.key
          : null;
    if (!key) {
      // A 200 with no key = still awaiting approval (some servers answer
      // {status:"pending"} instead of 404).
      if (body?.status === "pending") return { ok: true, paired: false, state: "pending" };
      return { ok: false, error: "Personas returned no API key for the claim." };
    }
    setBridgeConfig({ apiKey: key });
    markBridgeOk();
    pending.delete(nonce); // spent — the claim is single-use
    return { ok: true, paired: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach Personas." };
  }
}
