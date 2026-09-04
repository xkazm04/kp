// Behavioral coverage for the Personas bridge config store. This module carries
// four rules nothing in the repo asserted — `grep -rl bridge-store app --include
// '*.test.ts'` was empty before this file, across 166 lines holding a secret
// doctrine, an at-rest encryption boundary and a precedence order:
//
//   1. env beats the stored row beats the loopback default (the resolveRelay
//      precedence model), with trailing slashes stripped off every branch;
//   2. the key's three write semantics — omitted keeps, "" CLEARS and unpairs,
//      any other string replaces and pairs (setAtsConnection's contract);
//   3. the key is WRITE-ONLY over the API (`getBridgeConfig` exposes `hasKey`,
//      never the value) and encrypted at rest, so a whole-DB export carries no
//      plaintext pk_;
//   4. `markBridgeOk` stamps liveness and touches NOTHING else. Its statement
//      inserts `paired 0` and its ON CONFLICT updates only `last_ok_at` — widen
//      that upsert to the excluded row (the obvious "tidy-up") and every
//      successful Personas round-trip silently unpairs the deployment.
import { test, after, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import Database from "better-sqlite3";
import { openStore } from "../db-path.ts";
import { isEncryptedAtsSecret } from "../ats-secret.ts";
import {
  DEFAULT_PERSONAS_URL,
  getBridgeConfig,
  markBridgeOk,
  resolveBridge,
  setBridgeConfig,
} from "./bridge-store.ts";

before(() => {
  process.env.KP_SECRET = "bridge-store-unit-secret";
});

after(() => cleanupUnitDb());

afterEach(() => {
  delete process.env.PERSONAS_BRIDGE_URL;
  delete process.env.PERSONAS_BRIDGE_KEY;
});

/** The row as it actually sits on disk — the only way to prove the at-rest claim. */
function storedKey(): string | null {
  const row = openStore().prepare(`SELECT api_key FROM personas_bridge WHERE id = 'bridge'`).get() as
    | { api_key: string | null }
    | undefined;
  return row?.api_key ?? null;
}

test("resolveBridge: env beats the stored row beats the loopback default", () => {
  // Nothing stored, nothing in env.
  assert.deepEqual(resolveBridge(), { baseUrl: DEFAULT_PERSONAS_URL, apiKey: null, source: "default" });

  setBridgeConfig({ baseUrl: "http://127.0.0.1:9999/", apiKey: "pk_from_the_row" });
  const stored = resolveBridge();
  assert.equal(stored.source, "config");
  assert.equal(stored.apiKey, "pk_from_the_row");
  assert.equal(stored.baseUrl, "http://127.0.0.1:9999", "trailing slashes are stripped, or every URL joins to a double slash");

  process.env.PERSONAS_BRIDGE_URL = "http://127.0.0.1:7000//";
  process.env.PERSONAS_BRIDGE_KEY = "pk_from_the_env";
  const env = resolveBridge();
  assert.equal(env.source, "env");
  assert.equal(env.baseUrl, "http://127.0.0.1:7000");
  assert.equal(env.apiKey, "pk_from_the_env", "a config-less deployment must behave predictably: env wins outright");

  // The half-set env case is the sharp one: a URL with no key does NOT fall
  // through to the stored key, and getBridgeConfig agrees rather than reporting
  // a pairing the dispatch path will refuse.
  delete process.env.PERSONAS_BRIDGE_KEY;
  assert.equal(resolveBridge().apiKey, null, "env is one source, not a per-field merge");
  assert.equal(getBridgeConfig().paired, false, "…and the public view says the same thing");
});

test("setBridgeConfig: omitted keeps the key, \"\" clears it, a string replaces it", () => {
  setBridgeConfig({ baseUrl: "http://127.0.0.1:9420", apiKey: "pk_first" });
  assert.equal(getBridgeConfig().paired, true);

  // Omitted ⇒ untouched. The base-URL edit in Settings must not silently unpair.
  setBridgeConfig({ baseUrl: "http://127.0.0.1:9421" });
  assert.equal(resolveBridge().apiKey, "pk_first", "editing the URL alone must not disturb the key");
  assert.equal(getBridgeConfig().baseUrl, "http://127.0.0.1:9421");
  assert.equal(getBridgeConfig().paired, true);

  setBridgeConfig({ apiKey: "pk_second" });
  assert.equal(resolveBridge().apiKey, "pk_second");

  // "" is the UNPAIR verb — it clears the key without deleting the row, so the
  // configured base URL and the liveness stamp survive the unpair.
  setBridgeConfig({ apiKey: "" });
  assert.equal(resolveBridge().apiKey, null);
  assert.equal(getBridgeConfig().hasKey, false);
  assert.equal(getBridgeConfig().paired, false);
  assert.equal(getBridgeConfig().baseUrl, "http://127.0.0.1:9421", "unpairing is not a reset");
});

test("the pk_ key is encrypted at rest and never leaves through the public view", () => {
  setBridgeConfig({ baseUrl: "http://127.0.0.1:9420", apiKey: "pk_live_supersecret" });

  const onDisk = storedKey();
  assert.ok(onDisk, "the row must hold something");
  assert.notEqual(onDisk, "pk_live_supersecret", "a whole-DB export must not carry the plaintext key");
  assert.ok(isEncryptedAtsSecret(onDisk!), "…and what it carries must be the AES-GCM envelope, not an encoding");

  // The secret doctrine: the public view is what the API returns, and it carries
  // `hasKey` — never the value, under any name.
  const view = getBridgeConfig();
  assert.equal(view.hasKey, true);
  assert.doesNotMatch(JSON.stringify(view), /supersecret/, "the client-safe view must not contain the key");

  // resolveBridge is the server-internal reader, and it decrypts back to the
  // exact key that was stored.
  assert.equal(resolveBridge().apiKey, "pk_live_supersecret");
});

test("setBridgeConfig refuses a base URL that is not http(s)", () => {
  for (const bad of ["file:///etc/passwd", "127.0.0.1:9420", "javascript:alert(1)"]) {
    assert.throws(() => setBridgeConfig({ baseUrl: bad }), /http\(s\)/, `${bad} must be refused`);
  }
  // Empty means "no stored URL", not an invalid one — the default takes over.
  setBridgeConfig({ baseUrl: "" });
  assert.equal(getBridgeConfig().baseUrl, DEFAULT_PERSONAS_URL);
});

test("markBridgeOk stamps liveness and touches nothing else", () => {
  setBridgeConfig({ baseUrl: "http://127.0.0.1:9420", apiKey: "pk_still_paired" });
  const before = getBridgeConfig();
  assert.equal(before.paired, true);

  markBridgeOk();

  const after = getBridgeConfig();
  // The load-bearing assertion: markBridgeOk's INSERT hardcodes `paired 0` and
  // its ON CONFLICT updates ONLY last_ok_at. Widening that upsert to the
  // excluded row would make every successful Personas round-trip unpair the
  // deployment — a bug whose symptom (kp forgets its pairing whenever Personas
  // is working) points away from its cause.
  assert.equal(after.paired, true, "a successful round-trip must never unpair the deployment");
  assert.equal(after.hasKey, true);
  assert.equal(after.baseUrl, "http://127.0.0.1:9420", "…and must not blank the configured URL either");
  assert.equal(resolveBridge().apiKey, "pk_still_paired");
  assert.ok(after.lastOkAt, "the liveness stamp is the one thing it DOES write");
  assert.notEqual(after.lastOkAt, before.lastOkAt ?? null);

  setBridgeConfig({ apiKey: "" });
});

// ── the read→compute→write seam (/perfect wave 38) ─────────────────────────
//
// `setBridgeConfig` used to SELECT the row, merge the two fields in JS and then
// upsert the WHOLE merged row. Any writer that committed between those two
// statements was overwritten wholesale by the stale JS copy — and the field that
// costs is the pk_ key, so the symptom is "kp silently unpaired itself" with no
// error anywhere. `openStore()` hands every store its OWN connection, so this is
// not hypothetical single-thread pedantry: a second kp process (or a maintenance
// script) on the same file is exactly the writer that lands in the gap.
//
// The fix merges in SQL (`DO UPDATE SET x = CASE WHEN @setX THEN @x ELSE x END`)
// inside an IMMEDIATE transaction, so a field this call did not name reads its
// CURRENT stored value and the write lock is held from BEGIN.
//
// The interleave is simulated at exactly the seam it happens at: a competing
// write commits the moment the upsert statement is about to run — i.e. after any
// read the implementation may have taken. Patched on better-sqlite3's prototype
// because each store holds a private connection.
function withWriteInterleave(competing: () => void, body: () => void): void {
  const proto = Database.prototype as unknown as { prepare: (sql: string) => unknown };
  const originalPrepare = proto.prepare;
  let fired = false;
  proto.prepare = function patched(this: unknown, sql: string) {
    const stmt = originalPrepare.call(this, sql) as { run: (...a: unknown[]) => unknown };
    if (!sql.includes("INSERT INTO personas_bridge") || !sql.includes("ON CONFLICT")) return stmt;
    const originalRun = stmt.run.bind(stmt);
    stmt.run = (...args: unknown[]) => {
      if (!fired) {
        fired = true; // set FIRST: the competing write re-enters this same hook
        competing();
      }
      return originalRun(...args);
    };
    return stmt;
  };
  try {
    body();
  } finally {
    proto.prepare = originalPrepare;
  }
  assert.ok(fired, "the interleave must actually have run, or this test proves nothing");
}

test("setBridgeConfig: a claim that lands mid-write keeps the LATER key", () => {
  setBridgeConfig({ baseUrl: "http://127.0.0.1:9420", apiKey: "pk_early" });

  withWriteInterleave(
    // The concurrent writer: a pairing claim commits between whatever the call
    // below read and what it is about to write.
    () => setBridgeConfig({ apiKey: "pk_late" }),
    // An innocent base-URL edit — it names no key at all, so it must not be able
    // to destroy one.
    () => setBridgeConfig({ baseUrl: "http://127.0.0.1:9430" }),
  );

  assert.equal(resolveBridge().apiKey, "pk_late", "the later claim's key must survive a concurrent URL edit");
  assert.equal(getBridgeConfig().paired, true, "…and the deployment must still read as paired");
  assert.equal(getBridgeConfig().baseUrl, "http://127.0.0.1:9430", "…while the edit this call DID name still lands");

  setBridgeConfig({ apiKey: "" });
});

// The other direction of the same rule: a call that names ONLY the key must not
// carry a stale base URL back over one somebody else just changed.
test("setBridgeConfig: a key write does not resurrect a stale base URL", () => {
  setBridgeConfig({ baseUrl: "http://127.0.0.1:9420", apiKey: "" });

  withWriteInterleave(
    () => setBridgeConfig({ baseUrl: "http://127.0.0.1:9499" }),
    () => setBridgeConfig({ apiKey: "pk_claimed" }),
  );

  assert.equal(getBridgeConfig().baseUrl, "http://127.0.0.1:9499", "the URL the other writer set must stand");
  assert.equal(resolveBridge().apiKey, "pk_claimed", "…and this call's own field still lands");

  setBridgeConfig({ apiKey: "" });
});
