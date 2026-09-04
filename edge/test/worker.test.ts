// The Worker's doors, exercised in-process.
//
// WHY A DOUBLE AND NOT WRANGLER: the thing under test is a set of REFUSALS — an
// unsigned drain, a replayed ack, a malformed body, a D1 outage — and every one of
// them must be provable without a Cloudflare account, a network, or a `wrangler dev`
// that CI would have to boot. `src/index.ts` only ever touches its `Env`, so a
// ~90-line SQL-shaped double is the whole harness. The cost is stated: this pins the
// Worker's LOGIC, never Cloudflare's runtime. Sealing, Email Routing and the cron
// trigger still need a live deploy (see ../README.md).
//
// Run: `npm test` in edge/. NOT part of the repo's `npm run test:unit` — that
// launcher globs app/** and packages/** only (scripts/run-unit-tests.mjs).

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker, { type Env } from "../src/index.ts";

const SECRET = "edge-secret-for-tests";
const CALLBACK_SECRET = "callback-secret-for-tests";

// ---- the D1 double ---------------------------------------------------------
//
// Not a SQL engine: a matcher over the handful of statements src/index.ts issues.
// Anything it does not recognize THROWS, so a new query cannot silently pass here
// and then fail on Cloudflare.

type Row = Record<string, unknown>;

function makeDb(opts: { failOn?: RegExp } = {}) {
  const events: Row[] = [];
  const meta = new Map<string, string | null>();
  const nonces = new Map<string, number>();
  let seq = 0;

  function exec(sql: string, args: unknown[]): { rows: Row[]; changes: number } {
    if (opts.failOn?.test(sql)) throw new Error("D1_ERROR: simulated storage failure");
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT value FROM meta")) {
      const v = meta.get(String(args[0]));
      return { rows: v === undefined || v === null ? [] : [{ value: v }], changes: 0 };
    }
    if (q.startsWith("INSERT INTO meta")) {
      meta.set(String(args[0]), args[1] as string | null);
      return { rows: [], changes: 1 };
    }
    if (q.startsWith("INSERT INTO events")) {
      events.push({ seq: ++seq, kind: args[0], token: args[1], body: args[2], sealed: args[3], received_at: args[4] });
      return { rows: [], changes: 1 };
    }
    if (q.startsWith("SELECT seq, kind")) {
      const since = Number(args[0]);
      const limit = Number(args[1]);
      return { rows: events.filter((e) => Number(e.seq) > since).slice(0, limit), changes: 0 };
    }
    if (q.startsWith("SELECT COUNT(*) AS n FROM events WHERE seq >")) {
      return { rows: [{ n: events.filter((e) => Number(e.seq) > Number(args[0])).length }], changes: 0 };
    }
    if (q.startsWith("SELECT COUNT(*) AS n FROM events")) return { rows: [{ n: events.length }], changes: 0 };
    if (q.startsWith("DELETE FROM events")) {
      const before = events.length;
      for (let i = events.length - 1; i >= 0; i--) if (Number(events[i].seq) <= Number(args[0])) events.splice(i, 1);
      return { rows: [], changes: before - events.length };
    }
    if (q.startsWith("DELETE FROM nonces WHERE expires_at")) {
      for (const [k, exp] of nonces) if (exp <= Number(args[0])) nonces.delete(k);
      return { rows: [], changes: 0 };
    }
    if (q.startsWith("DELETE FROM nonces WHERE nonce")) {
      return { rows: [], changes: nonces.delete(String(args[0])) ? 1 : 0 };
    }
    if (q.startsWith("INSERT OR IGNORE INTO nonces")) {
      if (nonces.has(String(args[0]))) return { rows: [], changes: 0 };
      nonces.set(String(args[0]), Number(args[1]));
      return { rows: [], changes: 1 };
    }
    throw new Error(`the D1 double does not know this statement: ${q}`);
  }

  const DB = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          args = a;
          return stmt;
        },
        async first<T>(): Promise<T | null> {
          return (exec(sql, args).rows[0] as T) ?? null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          return { results: exec(sql, args).rows as T[] };
        },
        async run(): Promise<{ meta: { changes: number } }> {
          return { meta: { changes: exec(sql, args).changes } };
        },
      };
      return stmt;
    },
  };
  return { DB, events, meta, nonces };
}

function env(db: ReturnType<typeof makeDb>, extra: Record<string, string> = {}): Env {
  return { DB: db.DB, KP_EDGE_SECRET: SECRET, ...extra } as unknown as Env;
}

function signedHeaders(payload: string, ts = String(Date.now())): Record<string, string> {
  return {
    "x-kp-timestamp": ts,
    "x-kp-signature": createHmac("sha256", SECRET).update(`${ts}.${payload}`).digest("hex"),
  };
}

const call = (path: string, init?: RequestInit) => new Request(`https://edge.example${path}`, init);

// ---- signing + freshness ---------------------------------------------------

test("an unsigned drain is refused — the queue is not a public URL", async () => {
  const db = makeDb();
  const res = await worker.fetch(call("/drain?since=0"), env(db));
  assert.equal(res.status, 401);
});

test("a signature over the WRONG payload is refused", async () => {
  const db = makeDb();
  const res = await worker.fetch(call("/drain?since=0", { headers: signedHeaders("/drain?since=9") }), env(db));
  assert.equal(res.status, 401);
});

test("a signature outside the freshness window is refused", async () => {
  const db = makeDb();
  const stale = String(Date.now() - 6 * 60_000);
  const res = await worker.fetch(call("/drain?since=0", { headers: signedHeaders("/drain?since=0", stale) }), env(db));
  assert.equal(res.status, 401);
});

test("a correctly signed drain returns the queue in sequence order", async () => {
  const db = makeDb();
  await worker.fetch(call("/in/tok", { method: "POST", body: '{"email":"a@b.c"}' }), env(db));
  const res = await worker.fetch(call("/drain?since=0", { headers: signedHeaders("/drain?since=0") }), env(db));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { events: { seq: number }[]; pending: number };
  assert.equal(body.events.length, 1);
  assert.equal(body.pending, 1);
});

// ---- replay ----------------------------------------------------------------

test("REPLAY: a captured signed ack cannot be spent twice — 409, and nothing is deleted", async () => {
  const db = makeDb();
  await worker.fetch(call("/in/tok", { method: "POST", body: "{}" }), env(db));
  const body = JSON.stringify({ upto: 1 });
  const headers = signedHeaders(body);
  const first = await worker.fetch(call("/ack", { method: "POST", body, headers }), env(db));
  assert.equal(first.status, 200);
  await worker.fetch(call("/in/tok", { method: "POST", body: "{}" }), env(db));
  // The same bytes, the same timestamp, the same signature — a verbatim capture.
  const replay = await worker.fetch(call("/ack", { method: "POST", body, headers }), env(db));
  assert.equal(replay.status, 409, "a replayed signature is refused, not re-applied");
  assert.equal(db.events.length, 1, "the event queued after the first ack survives the replay");
});

test("REPLAY: /pair and /heartbeat are guarded too", async () => {
  for (const [path, payload] of [
    ["/pair", JSON.stringify({ publicJwk: '{"kty":"RSA"}' })],
    ["/heartbeat", JSON.stringify({ at: "now" })],
  ] as const) {
    const db = makeDb();
    const headers = signedHeaders(payload);
    assert.equal((await worker.fetch(call(path, { method: "POST", body: payload, headers }), env(db))).status, 200);
    assert.equal(
      (await worker.fetch(call(path, { method: "POST", body: payload, headers }), env(db))).status,
      409,
      `${path} accepted a replay`
    );
  }
});

test("a fresh call after a replay still works — the guard spends nonces, it does not lock the door", async () => {
  const db = makeDb();
  const a = JSON.stringify({ at: "1" });
  await worker.fetch(call("/heartbeat", { method: "POST", body: a, headers: signedHeaders(a) }), env(db));
  const b = JSON.stringify({ at: "2" });
  const res = await worker.fetch(call("/heartbeat", { method: "POST", body: b, headers: signedHeaders(b) }), env(db));
  assert.equal(res.status, 200);
});

// ---- the relay callback ----------------------------------------------------

test("the callback is DISABLED (503) until KP_CALLBACK_SECRET is set — fail closed", async () => {
  const db = makeDb();
  const res = await worker.fetch(call("/relay/callback", { method: "POST", body: "{}" }), env(db));
  assert.equal(res.status, 503);
  assert.equal(db.events.length, 0, "nothing was queued by an unauthenticated caller");
});

test("the callback refuses a wrong secret, and a missing or stale timestamp", async () => {
  const db = makeDb();
  const e = env(db, { KP_CALLBACK_SECRET: CALLBACK_SECRET });
  const body = JSON.stringify({ ref: "e1", kind: "offer", outcome: "bounce" });
  const post = (headers: Record<string, string>) => worker.fetch(call("/relay/callback", { method: "POST", body, headers }), e);
  assert.equal((await post({ "x-comms-secret": "wrong" })).status, 401);
  assert.equal((await post({ "x-comms-secret": CALLBACK_SECRET })).status, 401, "no timestamp is not fresh");
  assert.equal(
    (await post({ "x-comms-secret": CALLBACK_SECRET, "x-comms-timestamp": String(Date.now() - 6 * 60_000) })).status,
    401,
    "a stale timestamp is not fresh"
  );
  assert.equal(db.events.length, 0);
});

test("a well-formed receipt is held (202), and its exact replay is 409", async () => {
  const db = makeDb();
  const e = env(db, { KP_CALLBACK_SECRET: CALLBACK_SECRET });
  const body = JSON.stringify({ ref: "e1", kind: "offer", outcome: "bounce" });
  const headers = {
    "x-comms-secret": CALLBACK_SECRET,
    "x-comms-timestamp": String(Date.now()),
    "x-comms-nonce": "relay-nonce-1",
  };
  assert.equal((await worker.fetch(call("/relay/callback", { method: "POST", body, headers }), e)).status, 202);
  assert.equal((await worker.fetch(call("/relay/callback", { method: "POST", body, headers }), e)).status, 409);
  assert.equal(db.events.length, 1, "one bounce, not two");
});

// ---- the 400 / 503 split ---------------------------------------------------

test("malformed JSON is 400 on EVERY door, never a 500", async () => {
  const db = makeDb();
  const bad = "{not json";
  assert.equal((await worker.fetch(call("/in/tok", { method: "POST", body: bad }), env(db))).status, 400);
  for (const path of ["/ack", "/heartbeat", "/pair"]) {
    // A DISTINCT malformed body per door. The signature covers `ts.body`, not the
    // path, so one body signed three times inside the same millisecond is one
    // signature presented three times - and the nonce guard correctly answers the
    // second and third with 409. That is the replay rule working, not a 400 bug;
    // this test is about the JSON door, so it must not trip the other one.
    const body = `${bad} ${path}`;
    const res = await worker.fetch(call(path, { method: "POST", body, headers: signedHeaders(body) }), env(db));
    assert.equal(res.status, 400, `${path} answered ${res.status} to a malformed body`);
  }
  const e = env(db, { KP_CALLBACK_SECRET: CALLBACK_SECRET });
  const res = await worker.fetch(
    call("/relay/callback", {
      method: "POST",
      body: bad,
      headers: { "x-comms-secret": CALLBACK_SECRET, "x-comms-timestamp": String(Date.now()) },
    }),
    e
  );
  assert.equal(res.status, 400);
});

test("a STORAGE failure is 503 with a retry hint — not 400, which stops the sender retrying", async () => {
  const db = makeDb({ failOn: /INSERT INTO events/ });
  const res = await worker.fetch(call("/in/tok", { method: "POST", body: '{"email":"a@b.c"}' }), env(db));
  assert.equal(res.status, 503, "a D1 outage must not be reported as a bad request");
  assert.equal(res.headers.get("retry-after"), "30");
  const body = (await res.json()) as { retryable?: boolean; error?: string };
  assert.equal(body.retryable, true);
  assert.doesNotMatch(String(body.error), /D1_ERROR|simulated/, "the thrown message never reaches the wire");
});

test("a receipt whose append fails RELEASES its nonce, so the relay's retry re-runs", async () => {
  const failing = makeDb({ failOn: /INSERT INTO events/ });
  const e = env(failing, { KP_CALLBACK_SECRET: CALLBACK_SECRET });
  const body = JSON.stringify({ ref: "e1", kind: "offer", outcome: "bounce" });
  const headers = {
    "x-comms-secret": CALLBACK_SECRET,
    "x-comms-timestamp": String(Date.now()),
    "x-comms-nonce": "relay-nonce-2",
  };
  assert.equal((await worker.fetch(call("/relay/callback", { method: "POST", body, headers }), e)).status, 503);
  assert.equal(failing.nonces.size, 0, "a nonce may only outlive work that SUCCEEDED");
});

test("an oversize body is 413 before anything is parsed or stored", async () => {
  const db = makeDb();
  const huge = JSON.stringify({ pad: "x".repeat(200 * 1024) });
  assert.equal((await worker.fetch(call("/in/tok", { method: "POST", body: huge }), env(db))).status, 413);
  assert.equal(db.events.length, 0);
});

test("an unknown path is 404, not a 500", async () => {
  const db = makeDb();
  assert.equal((await worker.fetch(call("/nope"), env(db))).status, 404);
});
