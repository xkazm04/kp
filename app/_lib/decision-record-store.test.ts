// Tamper-EVIDENCE for the decision chain (bug-ui-scan §screening-decisions #1).
//
// The chain used to be a KEYLESS sha256 hash chain: an insider with decision_records
// write access could edit a row, recompute its (and every downstream) hash with the
// same public algorithm, and verifyDecisionChain() would still return ok:true. These
// tests pin the HMAC keying that closes that hole against a throwaway SQLite file,
// loading the REAL store so the guarantee can't drift from a copied-out helper.
//
// unit-db.ts MUST be the first project import: it sets KP_DB_PATH (via mkdtempSync —
// never a pid-named path) before the store's db-path module evaluates, so every seal
// opens an isolated file. node --test isolates each file in its own process, so the
// KP_DECISION_HMAC_KEY env mutations below can't leak to sibling test files. Every test
// body here is SYNCHRONOUS (better-sqlite3 is sync), so a body runs atomically and the
// per-scenario env set/restore can never interleave with another test.
import "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { UNIT_DB_PATH, cleanupUnitDb } from "./testing/unit-db.ts";
import { decisionContentHash } from "./decision-hash.ts";
import { sealDecisionRecord, verifyDecisionChain } from "./decision-record-store.ts";

after(() => cleanupUnitDb());

// Test-only key material (32 bytes of clearly-fake hex). The whole point is that the
// DB writer in a real deployment does NOT hold this — it lives only in server env.
const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

type Row = { seq: number; prev_hash: string; content_hash: string; payload_json: string; key_id: string };

/** A short-lived raw connection on the SAME WAL file every store opens — this is how
 *  the store and db.ts share kp.sqlite at runtime, and how an insider would touch the
 *  table out-of-band. */
function raw(): Database.Database {
  return new Database(UNIT_DB_PATH);
}

/** Map a candidateRef to a workspace, so seals build independent per-tenant chains
 *  (the store derives a seal's workspace from its subject entry). */
function seedEntry(id: string, workspaceId: string): void {
  const d = raw();
  d.exec(`CREATE TABLE IF NOT EXISTS pipeline_entries (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL DEFAULT 'workspace');`);
  d.prepare(`INSERT OR REPLACE INTO pipeline_entries (id, workspace_id) VALUES (?, ?)`).run(id, workspaceId);
  d.close();
}

function rows(ws: string): Row[] {
  const d = raw();
  const r = d
    .prepare(`SELECT seq, prev_hash, content_hash, payload_json, key_id FROM decision_records WHERE workspace_id = ? ORDER BY seq ASC`)
    .all(ws) as Row[];
  d.close();
  return r;
}

/** Overwrite a stored row out-of-band — the insider edit the chain must resist. */
function tamperRow(seq: number, f: { payload_json?: string; content_hash?: string; prev_hash?: string; key_id?: string }): void {
  const d = raw();
  if (f.payload_json !== undefined) d.prepare(`UPDATE decision_records SET payload_json=? WHERE seq=?`).run(f.payload_json, seq);
  if (f.content_hash !== undefined) d.prepare(`UPDATE decision_records SET content_hash=? WHERE seq=?`).run(f.content_hash, seq);
  if (f.prev_hash !== undefined) d.prepare(`UPDATE decision_records SET prev_hash=? WHERE seq=?`).run(f.prev_hash, seq);
  if (f.key_id !== undefined) d.prepare(`UPDATE decision_records SET key_id=? WHERE seq=?`).run(f.key_id, seq);
  d.close();
}

let n = 0;
function seal(ref: string) {
  n += 1;
  return sealDecisionRecord({
    kind: "auto_rejected",
    actor: "auto:screen-wave",
    policyVersion: "screen-wave/bottom10/maxMatch50",
    candidateRef: ref,
    rationale: `Auto-rejected candidate #${n}`,
    reasonCode: "reject",
    inputs: { score: 40 + n, approvedBy: "operator (single-operator deployment)" },
  });
}

/** Run `fn` with the active decision key set to (id, secret), restoring env after. */
function withKey<T>(id: string, secret: string, fn: () => T): T {
  const prevKey = process.env.KP_DECISION_HMAC_KEY;
  const prevId = process.env.KP_DECISION_HMAC_KEY_ID;
  process.env.KP_DECISION_HMAC_KEY = secret;
  process.env.KP_DECISION_HMAC_KEY_ID = id;
  try {
    return fn();
  } finally {
    if (prevKey === undefined) delete process.env.KP_DECISION_HMAC_KEY;
    else process.env.KP_DECISION_HMAC_KEY = prevKey;
    if (prevId === undefined) delete process.env.KP_DECISION_HMAC_KEY_ID;
    else process.env.KP_DECISION_HMAC_KEY_ID = prevId;
  }
}

// --- 1. A legitimately sealed keyed chain verifies clean --------------------------
test("a keyed chain seals and verifies ok", () => {
  const ws = "ws-keyed-clean";
  ["kc1", "kc2", "kc3"].forEach((id) => seedEntry(id, ws));
  withKey("k1", KEY_A, () => {
    seal("kc1");
    seal("kc2");
    seal("kc3");
    const v = verifyDecisionChain(ws);
    assert.equal(v.ok, true, "an untampered keyed chain verifies");
    assert.equal(v.count, 3);
    assert.equal(v.brokenAtSeq, null);
    // Every row carries the active key id (keyed, not keyless).
    assert.ok(rows(ws).every((r) => r.key_id === "k1"), "rows are keyed under the active key id");
  });
});

// --- 2. An insider's keyless re-hash of a keyed row is DETECTED --------------------
test("editing a keyed row and re-hashing it (without the key) FAILS verification", () => {
  const ws = "ws-keyed-tamper";
  ["kt1", "kt2", "kt3"].forEach((id) => seedEntry(id, ws));
  withKey("k1", KEY_A, () => {
    seal("kt1");
    seal("kt2");
    seal("kt3");
    assert.equal(verifyDecisionChain(ws).ok, true, "sanity: clean before tamper");

    // Insider rewrites the last row's rationale and recomputes its hash with the ONLY
    // algorithm they have — the public keyless one (they don't hold KP_DECISION_HMAC_KEY).
    const rs = rows(ws);
    const last = rs[rs.length - 1];
    const forgedPayload = { ...(JSON.parse(last.payload_json) as Record<string, unknown>), rationale: "REWRITTEN by an insider" };
    const forgedHash = decisionContentHash(last.prev_hash, forgedPayload);
    tamperRow(last.seq, { payload_json: JSON.stringify(forgedPayload), content_hash: forgedHash });

    const v = verifyDecisionChain(ws);
    assert.equal(v.ok, false, "a keyed row's keyless re-hash is rejected (needs the MAC key)");
    assert.equal(v.brokenAtSeq, last.seq);
  });
});

// --- 3. Downgrade attack (rewrite a keyed row as keyless) is DETECTED --------------
test("swapping a keyed row down to keyless (downgrade) FAILS verification", () => {
  const ws = "ws-downgrade";
  ["dg1", "dg2", "dg3"].forEach((id) => seedEntry(id, ws));
  withKey("k1", KEY_A, () => {
    seal("dg1");
    seal("dg2");
    seal("dg3");
    const rs = rows(ws);
    const last = rs[rs.length - 1];
    // Insider sets key_id='' and stores a valid KEYLESS hash, trying to escape the MAC.
    const forgedPayload = { ...(JSON.parse(last.payload_json) as Record<string, unknown>), rationale: "DOWNGRADED to keyless" };
    tamperRow(last.seq, {
      payload_json: JSON.stringify(forgedPayload),
      content_hash: decisionContentHash(last.prev_hash, forgedPayload),
      key_id: "",
    });
    const v = verifyDecisionChain(ws);
    assert.equal(v.ok, false, "a keyless row appearing after keyed rows is a downgrade forgery");
    assert.equal(v.brokenAtSeq, last.seq);
  });
});

// --- 4. Legacy rows still verify + NON-VACUITY PROOF ------------------------------
// A chain sealed with NO key configured is keyless (exactly like pre-fix rows). It must
// still verify (backward compatibility). And — the non-vacuity proof — the SAME insider
// re-hash that test 2 rejects on a keyed chain is ACCEPTED here on a keyless chain: this
// is the pre-fix behavior reproduced against the real verifier, so `assert(ok === false)`
// WOULD FAIL against the keyless/pre-fix chain. Only keying makes the tamper detectable.
test("legacy (keyless) rows verify, and a keyless chain ACCEPTS an insider re-hash (pre-fix behavior)", () => {
  const ws = "ws-legacy";
  ["lg1", "lg2", "lg3"].forEach((id) => seedEntry(id, ws));
  // No withKey → activeDecisionKey() is null → keyless seals (legacy rows).
  seal("lg1");
  seal("lg2");
  seal("lg3");
  assert.ok(rows(ws).every((r) => r.key_id === ""), "no key configured → keyless legacy rows");
  assert.equal(verifyDecisionChain(ws).ok, true, "legacy keyless rows verify unchanged (backward compatible)");

  // Same tamper technique as test 2, on the keyless chain:
  const rs = rows(ws);
  const last = rs[rs.length - 1];
  const forgedPayload = { ...(JSON.parse(last.payload_json) as Record<string, unknown>), rationale: "REWRITTEN by an insider" };
  tamperRow(last.seq, { payload_json: JSON.stringify(forgedPayload), content_hash: decisionContentHash(last.prev_hash, forgedPayload) });
  assert.equal(
    verifyDecisionChain(ws).ok,
    true,
    "PRE-FIX BEHAVIOR: a keyless chain accepts the re-hash — tamper UNDETECTED. This is precisely what the keyed chain (test 2) now catches; the fix is non-vacuous."
  );
});

// --- 5. Legacy PREFIX + keyed suffix: verifies, and enabling the key protects the
//        legacy history too (a fully-cascaded keyless forge is caught at the first
//        keyed link) --------------------------------------------------------------
test("a legacy-prefix + keyed-suffix chain verifies, and a cascaded prefix forge is caught at the first keyed link", () => {
  const ws = "ws-mixed";
  ["mx1", "mx2", "mx3", "mx4"].forEach((id) => seedEntry(id, ws));
  // Two keyless (pre-key) rows...
  seal("mx1");
  seal("mx2");
  // ...then the key is enabled and two keyed rows are appended.
  withKey("k1", KEY_A, () => {
    seal("mx3");
    seal("mx4");
    const v = verifyDecisionChain(ws);
    assert.equal(v.ok, true, "legacy prefix followed by keyed suffix verifies");
    assert.equal(v.count, 4);

    // Insider rewrites the FIRST legacy row and cascades the keyless prefix (mx1→mx2)
    // fully — but cannot re-MAC the first keyed row (mx3), whose prev_hash still points
    // at the OLD mx2 hash. Detection lands at mx3.
    const rs = rows(ws);
    const [r1, r2, r3] = rs;
    const p1 = { ...(JSON.parse(r1.payload_json) as Record<string, unknown>), rationale: "prefix rewrite" };
    const c1 = decisionContentHash("", p1); // r1 is genesis (prev_hash "")
    const p2 = JSON.parse(r2.payload_json) as Record<string, unknown>;
    const c2 = decisionContentHash(c1, p2); // cascade the keyless link
    tamperRow(r1.seq, { payload_json: JSON.stringify(p1), content_hash: c1 });
    tamperRow(r2.seq, { prev_hash: c1, content_hash: c2 });

    const bad = verifyDecisionChain(ws);
    assert.equal(bad.ok, false, "a fully-cascaded keyless prefix forge is still caught");
    assert.equal(bad.brokenAtSeq, r3.seq, "detection lands at the first keyed link (its prev_hash no longer matches)");
  });
});

// --- 6. Key rotation: old rows verify under the retired key; dropping it fails closed
test("rotation verifies old rows under a retired key, and a dropped retired key fails closed", () => {
  const ws = "ws-rotate";
  ["rt1", "rt2", "rt3"].forEach((id) => seedEntry(id, ws));
  // Seal the first row under key id "k1".
  withKey("k1", KEY_A, () => seal("rt1"));
  const firstSeq = rows(ws)[0].seq;

  // Rotate: "k2" becomes active; the retired "k1" secret is KEPT available for verify.
  process.env.KP_DECISION_HMAC_KEY_k1 = KEY_A;
  try {
    withKey("k2", KEY_B, () => {
      seal("rt2");
      seal("rt3");
      const v = verifyDecisionChain(ws);
      assert.equal(v.ok, true, "old k1 rows verify under the retired key while new rows use k2");
      assert.equal(v.count, 3);

      // Operator drops the retired key without migrating → its rows become unverifiable.
      delete process.env.KP_DECISION_HMAC_KEY_k1;
      const v2 = verifyDecisionChain(ws);
      assert.equal(v2.ok, false, "a rotated-away key that wasn't kept makes its rows fail closed");
      assert.equal(v2.brokenAtSeq, firstSeq, "the failure is the old-key row, not the new ones");
    });
  } finally {
    delete process.env.KP_DECISION_HMAC_KEY_k1;
  }
});

// --- 7. Safety net: refusing to append an unkeyed row onto a keyed chain ----------
// If the key is accidentally un-set after a chain is already keyed, sealing keyless
// would create a permanent downgrade break. The seal refuses (throws) instead, so the
// chain stays verifiable and the misconfiguration is loud.
// --- 8. The KEY CENSUS that conditions the on-screen claim (UAT LUC-ANA-1) ---------
// The panel used to render „Odolné proti manipulaci" (tamper-RESISTANT) over 66 records
// that were all key_id '' — i.e. over exactly the rows test 4 above proves it cannot
// vouch for. `ok` could not carry that distinction, so the verdict now ships the census
// and the badge branches on it. These assertions are what stop the strong claim from
// coming back: keyed=false is the live deployment's state.
test("the verdict reports the key census, so the badge can condition its claim on the key", () => {
  const ws = "ws-census-keyless";
  ["cs1", "cs2"].forEach((id) => seedEntry(id, ws));
  seal("cs1");
  seal("cs2");
  const keyless = verifyDecisionChain(ws);
  assert.equal(keyless.ok, true, "a never-keyed chain is internally consistent…");
  assert.equal(keyless.keyed, false, "…and must NOT report itself as keyed");
  assert.equal(keyless.keylessCount, 2, "every link is keyless");
  assert.equal(keyless.firstKeyedSeq, null, "there is no keyed link to anchor the prefix");
});

test("a fully keyed chain reports keyed:true with no keyless links", () => {
  const ws = "ws-census-keyed";
  ["ck1", "ck2"].forEach((id) => seedEntry(id, ws));
  withKey("k1", KEY_A, () => {
    seal("ck1");
    seal("ck2");
    const v = verifyDecisionChain(ws);
    assert.equal(v.keyed, true);
    assert.equal(v.keylessCount, 0);
    assert.equal(v.firstKeyedSeq, rows(ws)[0].seq, "the whole chain is keyed from its genesis link");
  });
});

test("a MIXED chain is not 'keyed', and names where the keyed protection begins", () => {
  // The honest middle state: the pre-key prefix carries no MAC of its own, but a forge
  // cascades into the first keyed link. The surface may say so — and must not round the
  // chain up to fully keyed.
  const ws = "ws-census-mixed";
  ["cm1", "cm2", "cm3"].forEach((id) => seedEntry(id, ws));
  seal("cm1");
  seal("cm2");
  withKey("k1", KEY_A, () => {
    seal("cm3");
    const v = verifyDecisionChain(ws);
    assert.equal(v.ok, true);
    assert.equal(v.keyed, false, "one keyless link is enough to disqualify the strong claim");
    assert.equal(v.keylessCount, 2);
    assert.equal(v.firstKeyedSeq, rows(ws)[2].seq, "protection begins at the first keyed link");
  });
});

test("the census survives a BROKEN verdict (the claim can't quietly upgrade on failure)", () => {
  const ws = "ws-census-broken";
  ["cb1", "cb2"].forEach((id) => seedEntry(id, ws));
  seal("cb1");
  seal("cb2");
  const rs = rows(ws);
  const last = rs[rs.length - 1];
  // A clumsy edit: payload rewritten WITHOUT re-hashing → the chain breaks.
  tamperRow(last.seq, { payload_json: JSON.stringify({ rationale: "clumsy" }) });
  const v = verifyDecisionChain(ws);
  assert.equal(v.ok, false);
  assert.equal(v.brokenAtSeq, last.seq);
  assert.equal(v.count, 2, "the census still describes the whole chain");
  assert.equal(v.keylessCount, 2);
  assert.equal(v.keyed, false);
});

test("an empty chain is not 'keyed' (no records is not a security property)", () => {
  assert.deepEqual(verifyDecisionChain("ws-census-empty"), {
    ok: true,
    count: 0,
    brokenAtSeq: null,
    keyed: false,
    keylessCount: 0,
    firstKeyedSeq: null,
  });
});

test("appending onto a keyed chain with the key removed throws (no silent downgrade)", () => {
  const ws = "ws-safety";
  ["sf1", "sf2"].forEach((id) => seedEntry(id, ws));
  withKey("k1", KEY_A, () => seal("sf1"));
  // Key now unset (outside withKey). Sealing sf2 keyless onto a keyed chain must throw.
  assert.throws(() => seal("sf2"), /keyed/i, "refuses to append an unkeyed row onto a keyed chain");
  // The chain is untouched and still verifies under the key.
  withKey("k1", KEY_A, () => {
    assert.equal(verifyDecisionChain(ws).ok, true, "the keyed chain is left intact and verifiable");
    assert.equal(verifyDecisionChain(ws).count, 1);
  });
});
