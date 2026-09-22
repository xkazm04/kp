// Live Work Surface — the session protocol, driven without a DOM.
//
// Challenge challenge-r02 devcase-live-work-surface/A. Until this file the only tests
// over the lazy mint, the 8s flush, the re-buffer and the seal-after-a-landed-flush
// submit read LiveWorkSurface.tsx as TEXT. These cases drive the extracted client
// against a fake fetch and a manual clock, with exact request counts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLiveWorkSync, MINT_REFUSAL_BACKOFF_MS, type SyncFetch } from "./liveWorkSync.ts";

type Call = { url: string; body: Record<string, unknown> };
type Reply = { status: number; body?: unknown } | "throw" | Promise<{ status: number; body?: unknown }>;

/** A scripted fetch: each URL pattern answers from its own queue (last reply repeats). */
function fakeFetch(routes: Array<[RegExp, Reply[]]>) {
  const calls: Call[] = [];
  const fetch: SyncFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
    const route = routes.find(([re]) => re.test(url));
    if (!route) throw new Error(`unscripted ${url}`);
    const queue = route[1];
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    const reply = await next;
    if (reply === "throw") throw new TypeError("network down");
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body ?? null,
    };
  };
  const count = (re: RegExp) => calls.filter((c) => re.test(c.url)).length;
  return { fetch, calls, count };
}

const MINT = /\/api\/devcase\/session$/;
const FLUSH = /\/api\/devcase\/session\/[^/]+$/;
const SUBMIT = /\/api\/devcase\/session\/[^/]+\/submit$/;

function harness(routes: Array<[RegExp, Reply[]]>, opts: { withSession?: string } = {}) {
  const f = fakeFetch(routes);
  let clock = 1_000_000;
  let persisted = 0;
  let cleared = 0;
  const sync = createLiveWorkSync({
    token: "tok-1",
    seedFiles: [
      { path: "src/index.ts", contents: "export const x = 1;\n" },
      { path: "DECISIONS.md", contents: "# Decisions\n" },
    ],
    fetch: f.fetch,
    now: () => clock,
    persist: () => void persisted++,
    clearDraft: () => void cleared++,
  });
  if (opts.withSession) sync.hydrate({ sessionId: opts.withSession, files: [], pending: [] });
  return {
    sync,
    ...f,
    advance: (ms: number) => void (clock += ms),
    persisted: () => persisted,
    cleared: () => cleared,
  };
}

const ev = (kind: "open" | "edit", path: string, t: number) => ({ t, kind, path });

test("idle visitor: no session and nothing pending -> flush resolves false with zero requests", async () => {
  const h = harness([[MINT, [{ status: 200, body: { sessionId: "s1" } }]]]);
  assert.equal(await h.sync.flush(), false);
  assert.equal(await h.sync.flush(), false);
  assert.equal(h.calls.length, 0, "the lazy-mint contract: reading the brief mints nothing");
});

test("concurrent mint: two ensureSession calls while the first mint is on the wire share one request", async () => {
  let release!: (v: { status: number; body?: unknown }) => void;
  const gate = new Promise<{ status: number; body?: unknown }>((r) => (release = r));
  const h = harness([[MINT, [gate]]]);
  const a = h.sync.ensureSession();
  const b = h.sync.ensureSession();
  release({ status: 200, body: { sessionId: "s1" } });
  assert.deepEqual(await Promise.all([a, b]), ["s1", "s1"]);
  assert.equal(h.count(MINT), 1);
  assert.equal(h.sync.getSnapshot().sessionId, "s1");
});

test("403 on flush: the batch and anything recorded meanwhile are re-buffered in order, sync is blocked", async () => {
  let release!: (v: { status: number; body?: unknown }) => void;
  const gate = new Promise<{ status: number; body?: unknown }>((r) => (release = r));
  const h = harness([[FLUSH, [gate]]], { withSession: "s1" });
  h.sync.hydrate({ sessionId: "s1", files: [], pending: [ev("open", "a.ts", 1)] });
  const flushing = h.sync.flush();
  await Promise.resolve();
  h.sync.record("edit", "b.ts");
  const persistedBefore = h.persisted();
  release({ status: 403 });
  assert.equal(await flushing, false);
  const snap = h.sync.getSnapshot();
  assert.deepEqual(
    snap.pending.map((e) => [e.kind, e.path]),
    [
      ["open", "a.ts"],
      ["edit", "b.ts"],
    ]
  );
  assert.equal(snap.syncBlocked, true);
  assert.ok(h.persisted() > persistedBefore, "the re-buffered batch reaches the local draft");
  // A refused session is not retried into the wall every 8 seconds.
  const before = h.calls.length;
  assert.equal(await h.sync.flush(), false);
  assert.equal(h.calls.length, before, "a blocked sync issues no further flush requests");
});

test("409 on flush: the dead id is dropped, the batch re-buffered, and the next flush mints once then posts it", async () => {
  const h = harness(
    [
      [MINT, [{ status: 200, body: { sessionId: "s2" } }]],
      [FLUSH, [{ status: 409 }, { status: 200, body: {} }]],
    ],
    { withSession: "s1" }
  );
  h.sync.record("open", "a.ts");
  assert.equal(await h.sync.flush(), false);
  assert.equal(h.sync.getSnapshot().sessionId, null);
  assert.equal(h.sync.getSnapshot().pending.length, 1);
  assert.equal(h.count(MINT), 0);

  assert.equal(await h.sync.flush(), true);
  assert.equal(h.count(MINT), 1, "exactly one fresh mint");
  const last = h.calls[h.calls.length - 1];
  assert.match(last.url, /\/session\/s2$/);
  assert.deepEqual((last.body.events as Array<{ path: string }>).map((e) => e.path), ["a.ts"]);
  assert.equal(h.sync.getSnapshot().pending.length, 0);
});

test("a coded mint refusal is not retried blind: backoff until retryMint or the window elapses", async () => {
  const h = harness([
    [
      MINT,
      [
        { status: 404, body: { code: "DEVCASE_SESSION_UNAVAILABLE", error: "English log line" } },
        { status: 404, body: { code: "DEVCASE_SESSION_UNAVAILABLE" } },
      ],
    ],
  ]);
  h.sync.record("open", "a.ts");
  await h.sync.ensureSession(); // settle the mint record() started
  assert.equal(h.count(MINT), 1);
  assert.equal(h.sync.getSnapshot().refusal?.code, "DEVCASE_SESSION_UNAVAILABLE");
  assert.equal(h.sync.getSnapshot().refusal?.error, null, "the server's English never reaches the page");

  h.sync.record("edit", "a.ts");
  h.sync.record("edit", "a.ts");
  h.sync.record("edit", "a.ts");
  h.advance(8_000);
  assert.equal(await h.sync.flush(), false);
  h.advance(8_000);
  assert.equal(await h.sync.flush(), false);
  assert.equal(h.count(MINT), 1, "no re-mint storm inside the backoff window");
  assert.equal(h.sync.getSnapshot().pending.length, 4, "the work is still buffered");

  await h.sync.retryMint();
  assert.equal(h.count(MINT), 2, "an explicit retry issues exactly one mint");

  // Refused again: the window re-arms (longer), and elapsing it on the clock lets one through.
  h.advance(8_000);
  await h.sync.flush();
  assert.equal(h.count(MINT), 2);
  h.advance(MINT_REFUSAL_BACKOFF_MS * 2 + 1);
  await h.sync.flush();
  assert.equal(h.count(MINT), 3, "the elapsed window admits exactly one mint");
});

test("a thrown mint stays retryable on the next tick (a dropped packet is not a refusal)", async () => {
  const h = harness([[MINT, ["throw", { status: 200, body: { sessionId: "s1" } }]], [FLUSH, [{ status: 200, body: {} }]]]);
  h.sync.record("open", "a.ts");
  await h.sync.ensureSession();
  assert.equal(h.sync.getSnapshot().refusal?.code, null);
  assert.equal(await h.sync.flush(), true);
  assert.equal(h.count(MINT), 2);
  assert.equal(h.sync.getSnapshot().refusal, null);
});

test("submit refuses to seal an unlanded tree", async () => {
  const h = harness([[FLUSH, [{ status: 500 }]], [SUBMIT, [{ status: 200, body: { reference: "DC-7Q" } }]]], {
    withSession: "s1",
  });
  h.sync.edit("src/index.ts", "export const x = 2;\n");
  await h.sync.submit({ candidate: "Ada", contact: "ada@example.com", locale: "en", activePath: "src/index.ts" });
  const snap = h.sync.getSnapshot();
  assert.equal(h.count(SUBMIT), 0, "no seal after a failed final flush");
  assert.equal(snap.status, "error");
  assert.equal(snap.errorKind, "generic");
  assert.equal(snap.filesDirty, true);
  assert.equal(h.cleared(), 0, "the local draft survives");
});

test("files ride only when dirty, and a thrown flush keeps them dirty", async () => {
  const h = harness([[FLUSH, [{ status: 200, body: {} }, { status: 200, body: {} }, "throw", { status: 200, body: {} }]]], {
    withSession: "s1",
  });
  h.sync.edit("src/index.ts", "export const x = 3;\n");
  assert.equal(await h.sync.flush(), true);
  assert.ok(Array.isArray(h.calls[0].body.files), "the edited tree rides the flush");
  assert.equal(await h.sync.flush(), true);
  assert.equal("files" in h.calls[1].body, false, "an idle tick sends events only");
  assert.ok(Array.isArray(h.calls[1].body.events));

  h.sync.edit("src/index.ts", "export const x = 4;\n");
  assert.equal(await h.sync.flush(), false);
  assert.equal(h.sync.getSnapshot().filesDirty, true);
  assert.equal(await h.sync.flush(), true);
  assert.ok(Array.isArray(h.calls[3].body.files), "the next tick re-sends the tree");
});

test("submit outcomes fold: a reference on 200, a terminal closed refusal on 410", async () => {
  const ok = harness([[FLUSH, [{ status: 200, body: {} }]], [SUBMIT, [{ status: 200, body: { reference: "DC-7Q" } }]]], {
    withSession: "s1",
  });
  await ok.sync.submit({ candidate: "Ada", contact: "ada@example.com", locale: "cs", activePath: "src/index.ts" });
  assert.equal(ok.sync.getSnapshot().status, "submitted");
  assert.equal(ok.sync.getSnapshot().reference, "DC-7Q");
  assert.equal(ok.cleared(), 1);
  const sealed = ok.calls.find((c) => SUBMIT.test(c.url))!;
  assert.deepEqual(sealed.body, { token: "tok-1", candidate: "Ada", contact: "ada@example.com", locale: "cs" });

  const closed = harness(
    [[FLUSH, [{ status: 200, body: {} }]], [SUBMIT, [{ status: 410, body: { code: "POSTING_CLOSED", error: "closed" } }]]],
    { withSession: "s1" }
  );
  await closed.sync.submit({ candidate: "Ada", contact: "ada@example.com", locale: "en", activePath: "src/index.ts" });
  const snap = closed.sync.getSnapshot();
  assert.equal(snap.status, "error");
  assert.equal(snap.errorKind, "closed");
  assert.equal(snap.refusal?.code, "POSTING_CLOSED");
  assert.equal(closed.cleared(), 0);
});
