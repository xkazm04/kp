import { createHash, createHmac } from "node:crypto";

// Decision System of Record (moonshot D) — the pure hashing primitives behind the
// tamper-evident decision chain. Kept separate from the SQLite store so the chain
// logic is deterministic + unit-testable (node:crypto is a built-in, so this still
// loads under bare `node --test`).

// Deterministic, key-sorted JSON: the same logical payload always serializes to
// the same string regardless of key insertion order. Arrays keep their order;
// objects are sorted by key recursively; `undefined` is dropped. This is what
// makes a re-hash on verify reproduce the seal-time hash.
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key];
      if (v !== undefined) out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

// One link of the chain: sha256 over the previous link's hash + the canonical
// payload. prevHash "" is the genesis link. Changing ANY field of ANY record (or
// reordering the chain) changes that link's hash and every hash after it — that
// cascade is the tamper-evidence.
//
// KEYLESS / LEGACY: this plain sha256 is only tamper-evident against a CLUMSY edit
// (an insider who re-runs this exact deterministic code reproduces a valid link and
// forges the chain). It survives only to verify rows sealed before the chain was
// keyed — every new keyed row uses decisionContentMac below. See the store's key
// registry and verifyDecisionChain for how the two coexist without a downgrade path.
//
// UAT LUC-ANA-1 — this function is exported, deterministic and secret-free BY DESIGN,
// which is precisely why a chain made only of these links may not be called
// tamper-RESISTANT on screen: reproducing it needs nothing an insider lacks. The
// verdict's key census (ChainVerdict.keylessCount) is what conditions that claim.
export function decisionContentHash(prevHash: string, payload: unknown): string {
  return createHash("sha256")
    .update(prevHash)
    .update("\n") // unambiguous separator so prevHash and payload can't blur together
    .update(canonicalize(payload))
    .digest("hex");
}

// KEYED link: HMAC-SHA256 under a server secret the DB writer does NOT hold, so an
// insider who can edit decision_records cannot recompute a valid link (they lack the
// key). `keyId` is bound INTO the MAC, so the stored key_id can't be swapped to point
// at a different / retired / weaker key without invalidating the link either. Same
// (prevHash → cascade) tamper-evidence as the keyless hash, but now UNFORGEABLE
// without the key. Genesis link is prevHash "".
export function decisionContentMac(prevHash: string, keyId: string, payload: unknown, secret: string): string {
  return createHmac("sha256", secret)
    .update(prevHash)
    .update("\n") // separator between prevHash and keyId
    .update(keyId)
    .update("\n") // separator between keyId and payload
    .update(canonicalize(payload))
    .digest("hex");
}
