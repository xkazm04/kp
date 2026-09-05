// The edge pairing's LOCAL half — the precedence rules, the honest "paired" answer,
// the cursor reset, and the one-and-only-one sealing keypair.
//
// Why these and not the drain loop: everything here is a decision made from the
// stored row alone, and three of the four have a failure mode that is invisible
// until it costs an operator real events —
//   · a URL with no secret answering "paired" (the drain then does nothing forever);
//   · a re-pair to a different edge resuming at a sequence number that edge never
//     issued, skipping everything below it;
//   · a second sealing keypair, which orphans every event sealed to the first.
// The last one is a read→compute→write across an ASYNC key generation, so it is
// pinned under concurrency rather than by inspection.
//
// unit-db.ts must be the first project import (it sets the throwaway KP_DB_PATH
// before db-path.ts is evaluated).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { openStore } from "./db-path.ts";
import {
  edgeOffline,
  ensureEdgeKeypair,
  getEdgeConfig,
  recordDrain,
  resolveEdge,
  resolveEdgeDetailed,
  setEdgeConfig,
} from "./edge-config.ts";

const URL_A = "https://kp-edge.example.com";
const URL_B = "https://kp-edge-two.example.com";

before(() => {
  // At-rest encryption needs a master key; the store falls back to KP_SECRET.
  process.env.KP_SECRET = "unit-test-master-key";
});

after(() => {
  cleanupUnitDb();
});

function clearEnv(): void {
  delete process.env.KP_EDGE_URL;
  delete process.env.KP_EDGE_SECRET;
  delete process.env.KP_NUDGE_TARGET;
  delete process.env.KP_OFFLINE;
}

function unpair(): void {
  clearEnv();
  setEdgeConfig({ url: "", secret: "", nudgeTarget: "" });
}

/** The raw stored column — the only way to prove the secret is not on disk in clear. */
function storedSecretColumn(): string | null {
  const row = openStore().prepare(`SELECT edge_secret FROM edge_config WHERE id = 1`).get() as
    | { edge_secret: string | null }
    | undefined;
  return row?.edge_secret ?? null;
}

test("no edge configured is the DEFAULT, not an error", () => {
  unpair();
  assert.equal(resolveEdge(), null);
  const cfg = getEdgeConfig();
  assert.equal(cfg.url, null);
  assert.equal(cfg.hasSecret, false);
  assert.equal(cfg.envConfigured, false);
  assert.equal(cfg.offline, false);
});

test("a stored pairing resolves, and the secret is ciphertext at rest", () => {
  unpair();
  const cfg = setEdgeConfig({ url: URL_A, secret: "s3cret-value" });
  assert.equal(cfg.url, URL_A);
  assert.equal(cfg.hasSecret, true);

  const stored = storedSecretColumn();
  assert.ok(stored, "the secret was stored");
  assert.ok(stored.startsWith("v1:"), "stored encrypted, never in clear");
  assert.ok(!stored.includes("s3cret-value"));

  const resolved = resolveEdge();
  assert.ok(resolved);
  assert.equal(resolved.secret, "s3cret-value", "and it round-trips for the signer");
  assert.equal(resolved.source, "config");
  assert.equal(resolved.url, URL_A);
});

test("an omitted secret KEEPS the stored one; an empty string clears it", () => {
  unpair();
  setEdgeConfig({ url: URL_A, secret: "keep-me" });
  setEdgeConfig({ url: URL_B }); // secret omitted
  assert.equal(resolveEdge()?.secret, "keep-me");
  assert.equal(resolveEdge()?.url, URL_B);
  setEdgeConfig({ url: URL_B, secret: "" });
  assert.equal(getEdgeConfig().hasSecret, false);
});

test("PRECEDENCE: env ▸ stored ▸ nothing", () => {
  unpair();
  setEdgeConfig({ url: URL_A, secret: "stored-secret" });
  process.env.KP_EDGE_URL = URL_B;
  process.env.KP_EDGE_SECRET = "env-secret";
  try {
    const cfg = getEdgeConfig();
    assert.equal(cfg.url, URL_B);
    assert.equal(cfg.envConfigured, true, "the editor must be able to say the env var is in charge");
    const resolved = resolveEdge();
    assert.equal(resolved?.url, URL_B);
    assert.equal(resolved?.secret, "env-secret");
    assert.equal(resolved?.source, "env");
  } finally {
    clearEnv();
  }
  // …and with the env gone the stored pairing is back, unharmed.
  assert.equal(resolveEdge()?.source, "config");
  assert.equal(resolveEdge()?.secret, "stored-secret");
});

test("a URL with NO secret is not paired — an unsigned drain would accept anyone's events", () => {
  unpair();
  setEdgeConfig({ url: URL_A, secret: "" });
  assert.equal(getEdgeConfig().url, URL_A, "the URL is remembered…");
  assert.equal(getEdgeConfig().hasSecret, false);
  assert.equal(resolveEdge(), null, "…but nothing will drain through it");
});

test("KP_OFFLINE=1 wins over a perfectly good pairing", () => {
  unpair();
  setEdgeConfig({ url: URL_A, secret: "s" });
  process.env.KP_OFFLINE = "1";
  try {
    assert.equal(edgeOffline(), true);
    assert.equal(getEdgeConfig().offline, true);
    assert.equal(resolveEdge(), null, "an air-gapped install makes no outbound call");
  } finally {
    delete process.env.KP_OFFLINE;
  }
  assert.ok(resolveEdge(), "and it comes back when the flag goes away");
});

test("unpairing RESETS the cursor, so a re-pair cannot skip a new edge's backlog", () => {
  unpair();
  setEdgeConfig({ url: URL_A, secret: "s" });
  recordDrain({ cursor: 42, error: null });
  assert.equal(getEdgeConfig().cursor, 42);
  setEdgeConfig({ url: "" });
  assert.equal(getEdgeConfig().cursor, 0, "a different edge's seq 1..41 must not be skipped");
  setEdgeConfig({ url: URL_B, secret: "s" });
  assert.equal(getEdgeConfig().cursor, 0);
});

test("the drain cursor only ever moves FORWARD", () => {
  unpair();
  setEdgeConfig({ url: URL_A, secret: "s" });
  recordDrain({ cursor: 10, error: null });
  recordDrain({ cursor: 4, error: "edge unreachable" });
  const cfg = getEdgeConfig();
  assert.equal(cfg.cursor, 10, "a failed pass must not rewind past applied events");
  assert.equal(cfg.lastError, "edge unreachable");
  assert.ok(cfg.lastDrainAt);
});

test("two concurrent 'Enable sealing' calls mint exactly ONE keypair", async () => {
  unpair();
  setEdgeConfig({ url: URL_A, secret: "s" });
  // The defect: key generation is async, so both callers read "no keypair", both
  // generate, and the second write orphans everything sealed to the first key.
  const [a, b] = await Promise.all([ensureEdgeKeypair(), ensureEdgeKeypair()]);
  assert.equal(a, b, "both callers must be handed the published key");
  const c = await ensureEdgeKeypair();
  assert.equal(c, a, "and it is never rotated afterwards");
  assert.equal(getEdgeConfig().sealed, true);
  const stored = openStore().prepare(`SELECT public_jwk, private_jwk FROM edge_config WHERE id = 1`).get() as {
    public_jwk: string | null;
    private_jwk: string | null;
  };
  assert.equal(stored.public_jwk, a);
  assert.ok(stored.private_jwk?.startsWith("v1:"), "the private half is encrypted at rest");
});

test("the sealing keypair survives a re-pair — unpairing must not orphan sealed events", () => {
  const before = getEdgeConfig().sealed;
  assert.equal(before, true, "guard the guard: the previous test published a key");
  setEdgeConfig({ url: "" });
  assert.equal(getEdgeConfig().sealed, true, "the edge may still hold bodies sealed to it");
});

// --- an unreadable secret ---------------------------------------------------------
// KP_SECRET (or KP_ATS_SECRET_KEY) rotated, or the retired key dropped before
// `secrets:rotate` ran: the ciphertext is still there and nothing can open it. That
// used to THROW out of resolveEdge — through drainEdge, documented "never throws",
// into an unhandled 500 on Drain now — while `getEdgeConfig` never decrypted at all
// and reported `hasSecret: true`, so the card stayed green over a dead pairing.

function withRotatedMasterKey<T>(fn: () => T): T {
  const key = process.env.KP_SECRET;
  process.env.KP_SECRET = "a-master-key-that-opens-nothing-here";
  try {
    return fn();
  } finally {
    process.env.KP_SECRET = key;
  }
}

test("a secret nobody can decrypt is a REFUSAL, not a throw and not a green card", () => {
  unpair();
  setEdgeConfig({ url: URL_A, secret: "sealed-under-the-old-key" });
  assert.equal(getEdgeConfig().hasSecret, true, "guard the guard: readable before the key moves");

  withRotatedMasterKey(() => {
    const cfg = getEdgeConfig();
    assert.equal(cfg.url, URL_A, "the URL is still what the operator configured");
    assert.equal(cfg.hasSecret, false, "hasSecret means READABLE — a card cannot be green over a dead pairing");

    const detailed = resolveEdgeDetailed();
    assert.equal(detailed.ok, false, "the caller that can act on it is told which failure this is");
    assert.equal(detailed.ok === false ? detailed.kind : null, "secret_unreadable");
    assert.ok(detailed.ok === false && detailed.error.length > 0, "with a diagnostic for the server log");

    assert.equal(resolveEdge(), null, "and the thin resolver answers 'no edge' rather than throwing");
  });

  assert.equal(getEdgeConfig().hasSecret, true, "putting the key back is the whole recovery");
  assert.equal(resolveEdge()?.secret, "sealed-under-the-old-key");
});

test("the env pairing is untouched by an unreadable STORED secret", () => {
  unpair();
  setEdgeConfig({ url: URL_A, secret: "sealed-under-the-old-key" });
  // The sealing keypair a previous test minted is sealed under the same master key,
  // and an unreadable PRIVATE half is its own refusal (the drain could not unseal a
  // single body). Clear it so this test asserts one thing: the env SECRET's
  // precedence over a stored ciphertext nobody can open.
  openStore().prepare(`UPDATE edge_config SET private_jwk = NULL WHERE id = 1`).run();
  withRotatedMasterKey(() => {
    process.env.KP_EDGE_URL = URL_B;
    process.env.KP_EDGE_SECRET = "env-secret";
    try {
      // env ▸ stored, and "in charge" means the broken row is never consulted: an
      // operator whose env pairing works must not be stopped by a stale ciphertext.
      assert.equal(getEdgeConfig().hasSecret, true);
      const detailed = resolveEdgeDetailed();
      assert.equal(detailed.ok, true);
      assert.equal(detailed.ok === true ? detailed.edge?.secret : null, "env-secret");
    } finally {
      clearEnv();
    }
  });
});

test("a LEGACY plaintext secret still resolves — the tolerance predates the encryption", () => {
  unpair();
  setEdgeConfig({ url: URL_A, secret: "s" });
  openStore().prepare(`UPDATE edge_config SET edge_secret = ? WHERE id = 1`).run("plain-legacy-secret");
  assert.equal(getEdgeConfig().hasSecret, true);
  assert.equal(resolveEdge()?.secret, "plain-legacy-secret");
});

test("an unreadable SEALING key is the same refusal — the drain could not unseal a body", async () => {
  unpair();
  setEdgeConfig({ url: URL_A, secret: "s" });
  await ensureEdgeKeypair();
  withRotatedMasterKey(() => {
    const detailed = resolveEdgeDetailed();
    assert.equal(detailed.ok, false, "holding on every sealed event one at a time is not an answer");
    assert.equal(detailed.ok === false ? detailed.kind : null, "secret_unreadable");
  });
});
