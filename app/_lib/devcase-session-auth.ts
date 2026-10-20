import { createHash, timingSafeEqual } from "node:crypto";
import { jsonRefusal } from "./api-response";
import { getDevSessionMeta, type DevSessionMeta } from "./db/devcase";
import { randomToken } from "./random-id";

// A dev-case session id is NOT an authorization capability. It is a Math.random id that
// rides the URL of every call (devtools copies, shared screens, proxy logs), and the apply
// token is per POSTING, shared by every applicant. Until challenge-r06 those two were the
// whole authority: another applicant holding a session id could overwrite its file tree,
// spend its model budget or seal it early.
//
// THE SESSION KEY: the public mint hands the minting device a CSPRNG key ONCE; the row
// keeps only `key_hash` (sha256). The flush / chat / finalize doors all open through ONE
// guard, `openSessionDoor`, which demands the key (a header, never the URL; constant-time)
// on a keyed row. LEGACY rows (key_hash NULL: minted before the key, or fixtures) keep the
// apply-token rule, so an attempt in flight at deploy is not locked out. TOKENLESS rows
// (fixtures, seeds) are proven by nothing and refused on every door.

/** The header the key travels in. The client mirrors this literal (liveWorkSync.ts cannot
 *  import node:crypto); devcase-session-auth.test.ts pins that the two agree. */
export const SESSION_KEY_HEADER = "x-devcase-session-key";

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/** A fresh per-attempt key: `dsk-` + 32 base64url chars from 24 CSPRNG bytes (~192 bits). */
export function mintSessionKey(): string {
  return randomToken("dsk");
}

/** What the store keeps: hex sha256 of the key. The raw key is never persisted. */
export function hashSessionKey(key: string): string {
  return digest(key).toString("hex");
}

/** True when `presented` hashes to the stored `keyHash`. Constant-time over the two
 *  32-byte digests, so neither the key's length nor a matching prefix is observable. */
export function sessionKeyMatches(keyHash: string | null | undefined, presented: unknown): boolean {
  if (!keyHash || !/^[0-9a-f]{64}$/.test(keyHash)) return false;
  if (typeof presented !== "string") return false;
  const candidate = presented.trim();
  if (!candidate) return false;
  return timingSafeEqual(digest(candidate), Buffer.from(keyHash, "hex"));
}

/** True when `presented` is the apply token that owns this session. Hash-then-compare
 *  (the `api/auth/login` convention) so the comparison is constant-time and safe for
 *  unequal lengths. The proof a LEGACY (unkeyed) row still accepts. */
export function sessionTokenMatches(sessionToken: string | null | undefined, presented: unknown): boolean {
  if (!sessionToken) return false;
  if (typeof presented !== "string") return false;
  const candidate = presented.trim();
  if (!candidate) return false;
  return timingSafeEqual(digest(candidate), digest(sessionToken));
}

/** Shared 403 body for a session presented without (or with the wrong) proof. NOT 404/409:
 *  those tell `LiveWorkSurface` to re-mint, which would spin the per-token/day quota. (The
 *  client re-mints ONCE on a keyless 403, when the device lost its key, then blocks.) */
export const SESSION_TOKEN_REQUIRED = "This work session belongs to a different apply link.";

type DoorRow = Pick<DevSessionMeta, "token" | "status" | "keyHash">;
export type DoorNeed = "active" | "any";
export type DoorProof = { key: unknown; token: unknown };
export type DoorRefusal = {
  code: "DEVCASE_SESSION_NOT_FOUND" | "DEVCASE_SESSION_ALREADY_SUBMITTED" | "SESSION_TOKEN_REQUIRED";
  status: 403 | 404 | 409;
};

/** Lifecycle half (pure): 404 unknown, 409 sealed when the door needs an active session
 *  (`"any"` is finalize, whose repeat is the idempotent retry), 403 tokenless, so every
 *  opened door has a token to charge its budgets to. */
export function sessionDoorLifecycle(row: DoorRow | null, need: DoorNeed): DoorRefusal | null {
  if (!row) return { code: "DEVCASE_SESSION_NOT_FOUND", status: 404 };
  if (need === "active" && row.status !== "active") return { code: "DEVCASE_SESSION_ALREADY_SUBMITTED", status: 409 };
  if (!row.token) return { code: "SESSION_TOKEN_REQUIRED", status: 403 };
  return null;
}

/** Authority half (pure): a keyed row accepts ONLY its key; a legacy row the apply token. */
export function sessionDoorProof(row: DoorRow, proof: DoorProof): DoorRefusal | null {
  if (!row.token) return { code: "SESSION_TOKEN_REQUIRED", status: 403 };
  const ok = row.keyHash ? sessionKeyMatches(row.keyHash, proof.key) : sessionTokenMatches(row.token, proof.token);
  return ok ? null : { code: "SESSION_TOKEN_REQUIRED", status: 403 };
}

export type SessionDoor =
  | { ok: false; response: Response }
  | {
      ok: true;
      session: DevSessionMeta & { token: string };
      /** After the body read (the legacy proof rides in it), before any limiter or write. */
      authorize(headers: Headers, bodyToken: unknown): Response | null;
    };

/** THE chokepoint of every mutating candidate door: one lookup and the lifecycle refusals
 *  before the door reads its body, then `authorize()` for the proof. Routes keep their own
 *  budgets and bodies; none re-implements this decision. */
export function openSessionDoor(id: string, opts: { need: DoorNeed }): SessionDoor {
  const session = getDevSessionMeta(id);
  const refused = sessionDoorLifecycle(session, opts.need);
  if (refused || !session?.token) {
    return { ok: false, response: jsonRefusal(refused?.code ?? "DEVCASE_SESSION_NOT_FOUND", refused?.status ?? 404) };
  }
  const token = session.token;
  return {
    ok: true,
    session: { ...session, token },
    authorize(headers, bodyToken) {
      const denied = sessionDoorProof(session, { key: headers.get(SESSION_KEY_HEADER), token: bodyToken });
      return denied ? jsonRefusal(denied.code, denied.status) : null;
    },
  };
}
