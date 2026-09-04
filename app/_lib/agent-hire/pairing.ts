import { atsSecretKeyConfigured } from "../ats-secret";
import { publicBaseUrl } from "../public-base-url";
import { randomToken } from "../random-id";
import {
  AGENT_BRIDGE_RESPONSE_TOO_LARGE,
  BRIDGE_RESPONSE_TOO_LARGE_MESSAGE,
  BRIDGE_TIMEOUT_MS,
  isRedirectResponse,
  readBridgeJson,
  REDIRECT_ERROR,
  resolveBridgeOrFail,
} from "./bridge-client";
import { markBridgeOk, setBridgeConfig } from "./bridge-store";

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
// Loopback by design — see bridge-client.ts for why no SSRF guard runs here, and
// why every bridge call is issued `redirect: "manual"` (the claim response
// carries the pk_ key, and the request carries the nonce that redeems it).

// The deadline is BRIDGE_TIMEOUT_MS, imported from bridge-client: this module used
// to declare its own `TIMEOUT_MS = 5_000` beside that one, so tuning the bridge
// deadline moved three of the five calls and left both pairing phases behind.
export const PAIRING_SCOPES = ["personas:read", "personas:build"] as const;
const NONCE_TTL_MS = 300_000; // mirrors the Personas-side TTL

// In-process pending nonces (single Next server process — same rationale as
// rate-limit.ts). A restart just means starting a fresh pairing.
const pending = new Map<string, number>(); // nonce -> expiresAt ms

function sweep(now: number): void {
  for (const [n, exp] of pending) if (exp <= now) pending.delete(n);
}

/**
 * The claim stores the pk_ key ENCRYPTED (bridge-store → ats-secret), and that
 * needs `KP_SECRET` / `KP_ATS_SECRET_KEY`. Without one, `encryptAtsSecret`
 * throws — and it threw at the worst possible moment: inside the CLAIM, i.e.
 * after a human had already approved the request in Personas and the single-use
 * nonce had been spent there. The operator got a 502 whose text talked about the
 * *ATS webhook signing secret*, and the approval was gone.
 *
 * So both phases refuse up front instead, with the reason and the fix. Checked in
 * `claimPairing` too, not only in `startPairing`: the env can change between the
 * two calls (a restart mid-pairing), and burning the claim is the expensive half.
 */
export const PAIR_NO_SECRET_CODE = "AGENT_PAIR_NO_SECRET";
export const PAIR_NO_SECRET_ERROR =
  "kp cannot store the Personas key: set KP_SECRET (or KP_ATS_SECRET_KEY) in the server environment and restart, then pair again. The key is held encrypted at rest, so without one the claim fails AFTER the request has been approved in Personas.";

export type PairFailure = { ok: false; error: string; code?: string };
export type PairStartResult = { ok: true; nonce: string; expiresInS: number } | PairFailure;

/** Phase 1: mint a nonce and register the pairing request with Personas. */
export async function startPairing(): Promise<PairStartResult> {
  // BEFORE anything is registered: never ask a human to approve a pairing whose
  // key this deployment could not keep.
  if (!atsSecretKeyConfigured()) return { ok: false, error: PAIR_NO_SECRET_ERROR, code: PAIR_NO_SECRET_CODE };
  // A key configured but UNREADABLE (rotated secret, corrupt ciphertext) is a
  // different failure from no key at all, and resolving it throws — structured,
  // like every other refusal here, so a re-pair is never blocked by a crash.
  const resolved = resolveBridgeOrFail();
  if (!resolved.ok) return resolved.failure;
  const bridge = resolved.bridge;
  // randomToken mints prefix + 32 base64url chars — comfortably ≥16 chars of CSPRNG entropy.
  const nonce = randomToken("pairn");
  try {
    const r = await fetch(`${bridge.baseUrl}/pair/request`, {
      method: "POST",
      // Personas reads the pairing origin from the Origin HEADER, never the
      // body, and binds the minted pk_ key (and its CORS allowlist entry) to
      // it. A server-side Node fetch sends no Origin on its own, so without
      // this line every real pairing died with "400 Origin header required" —
      // the P5b mock did not enforce the header, which is how it hid this.
      headers: { "Content-Type": "application/json", Origin: publicBaseUrl() },
      body: JSON.stringify({ nonce, scopes: PAIRING_SCOPES, client: "kp" }),
      redirect: "manual",
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    });
    if (isRedirectResponse(r)) return { ok: false, error: REDIRECT_ERROR };
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
  | PairFailure;

/** Phase 2: one claim attempt for a nonce startPairing minted. "pending" until
 *  the human approves in Personas; on success the key is stored encrypted and
 *  the claim (single-use on the Personas side) is spent. */
export async function claimPairing(nonce: string): Promise<PairClaimResult> {
  // Refused BEFORE the GET: the claim is single-use on the Personas side, so
  // spending it on a key kp is about to fail to store costs the operator the
  // whole approval round-trip.
  if (!atsSecretKeyConfigured()) return { ok: false, error: PAIR_NO_SECRET_ERROR, code: PAIR_NO_SECRET_CODE };
  const now = Date.now();
  sweep(now);
  const exp = pending.get(nonce);
  if (!exp || exp <= now) return { ok: false, error: "Unknown or expired pairing nonce — start pairing again." };
  const resolved = resolveBridgeOrFail();
  if (!resolved.ok) return resolved.failure;
  const bridge = resolved.bridge;
  try {
    const r = await fetch(`${bridge.baseUrl}/pair/claim?nonce=${encodeURIComponent(nonce)}`, {
      // Same origin the request phase declared — the claim is origin-checked.
      headers: { Origin: publicBaseUrl() },
      redirect: "manual",
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    });
    // Before the pending checks: an opaque redirect is status 0, and a redirect
    // is neither "still pending" nor a place to hand the nonce to.
    if (isRedirectResponse(r)) return { ok: false, error: REDIRECT_ERROR };
    if (r.status === 404 || r.status === 202) return { ok: true, paired: false, state: "pending" };
    if (!r.ok) return { ok: false, error: `Personas responded ${r.status} to the pairing claim.` };
    // The REAL bridge answers { token } (probed 2026-08-24); apiKey/key are
    // kept for older builds. The mock now emits { token } so the e2e pins the
    // real shape.
    // Bounded, like every other bridge read: the claim answer is a short JSON
    // object with one key in it, and an unbounded `r.json()` here would buffer
    // whatever a wedged local process streams back.
    const read = await readBridgeJson<{
      apiKey?: unknown;
      key?: unknown;
      token?: unknown;
      status?: unknown;
    }>(r);
    if (!read.ok) return { ok: false, error: BRIDGE_RESPONSE_TOO_LARGE_MESSAGE, code: AGENT_BRIDGE_RESPONSE_TOO_LARGE };
    const body = read.value;
    const key =
      typeof body?.token === "string" && body.token
        ? body.token
        : typeof body?.apiKey === "string" && body.apiKey
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
