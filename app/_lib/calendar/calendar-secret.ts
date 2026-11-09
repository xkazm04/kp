// At-rest encryption for the Google Calendar credentials kp stores itself (AES-256-GCM):
// the OAuth client secret the owner pastes into Settings > Integrations, and the grant
// tokens on an install that has no ATS/session key to seal them under.
//
// Fourth application of the secret doctrine (llm-secret → ats-secret → token-store → here)
// and the same shape as ats-secret.ts on purpose: a DEDICATED key, KP_CALENDAR_SECRET_KEY,
// falling back to KP_SECRET, so an existing single-secret deployment needs nothing new.
//
// WHY A DEDICATED KEY. A keyless local install has no KP_SECRET, and the guided setup must
// not need a restart. calendar-key.ts therefore GENERATES a key on the save path when none
// is set, and it generates THIS one, never KP_SECRET: KP_SECRET also signs sessions and edge
// requests (auth/edge-verify.ts), so minting it would silently change the auth posture of an
// install whose owner only asked to connect a calendar.
//
// Ciphertext format: "v1:<iv b64>:<auth tag b64>:<data b64>" (same as llm-secret/ats-secret).
// Dependency-free, so it is unit-testable without the db import chain.
//
// ROTATION mirrors ats-secret.ts: the retired key is read from KP_CALENDAR_SECRET_KEY_PREVIOUS,
// falling back to KP_SECRET_PREVIOUS; encryption ALWAYS uses the current key.

import crypto from "node:crypto";

type Env = Record<string, string | undefined>;

function currentSecret(env: Env): string {
  return env.KP_CALENDAR_SECRET_KEY?.trim() || env.KP_SECRET?.trim() || "";
}

/** True when a key is available to seal/open calendar credentials at rest. */
export function calendarSecretKeyConfigured(env: Env = process.env): boolean {
  return !!currentSecret(env);
}

function derive(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

function masterKey(): Buffer {
  const secret = currentSecret(process.env);
  if (!secret) {
    // Names the variables, never a value.
    throw new Error("KP_CALENDAR_SECRET_KEY (or KP_SECRET) is not set, so a calendar credential cannot be sealed or opened.");
  }
  return derive(secret);
}

/** The retired key a rotation is still reading from, or null. Never used to ENCRYPT. */
function previousKey(): Buffer | null {
  const secret = process.env.KP_CALENDAR_SECRET_KEY_PREVIOUS?.trim() || process.env.KP_SECRET_PREVIOUS?.trim();
  return secret ? derive(secret) : null;
}

function decryptWith(key: Buffer, ivB64: string, tagB64: string, dataB64: string): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf-8");
}

export function encryptCalendarSecret(plaintext: string): string {
  const key = masterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`;
}

export function decryptCalendarSecret(ciphertext: string): string {
  return decryptCalendarSecretDetailed(ciphertext).plaintext;
}

/** Decrypt, and say WHICH key opened it (`previous` = the row still needs re-sealing). */
export function decryptCalendarSecretDetailed(ciphertext: string): { plaintext: string; under: "current" | "previous" } {
  const [version, ivB64, tagB64, dataB64] = ciphertext.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Unrecognized calendar secret ciphertext format.");
  }
  try {
    return { plaintext: decryptWith(masterKey(), ivB64, tagB64, dataB64), under: "current" };
  } catch (err) {
    const fallback = previousKey();
    if (!fallback) throw err;
    try {
      return { plaintext: decryptWith(fallback, ivB64, tagB64, dataB64), under: "previous" };
    } catch {
      // Neither key opens it: report the CURRENT key's failure.
      throw err;
    }
  }
}
