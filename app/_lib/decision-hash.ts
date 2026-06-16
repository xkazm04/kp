import { createHash } from "node:crypto";

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
export function decisionContentHash(prevHash: string, payload: unknown): string {
  return createHash("sha256")
    .update(prevHash)
    .update("\n") // unambiguous separator so prevHash and payload can't blur together
    .update(canonicalize(payload))
    .digest("hex");
}
