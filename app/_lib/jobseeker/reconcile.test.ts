// reconcileSource on an in-memory adapter and in-memory deps: the counts, the
// outcome vocabulary, and the pause/no-pause decisions per failure kind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_PREFERENCES, type JobseekerSource, type PauseReason, type RawPosting, type SourceRunOutcome } from "./types.ts";
import { AdapterCollapsed, DEFAULT_ADAPTER_LIMITS, FetchHalt, type AdapterContext, type PostingRef, type SourceAdapter } from "./adapters/types.ts";
import { RECONCILE_REASONS, reconcileSource, type ReconcileDeps } from "./reconcile.ts";
import type { FetchFailure } from "./fetch/politeFetch.ts";
import { detailOk } from "./adapters/shared.ts";

const src: JobseekerSource = {
  id: "jss-1",
  kind: "board",
  adapter: "board_rules",
  tier: "B",
  host: "b.example",
  config: {},
  enabled: true,
  acknowledgedAt: null,
  acknowledgedTermsHash: null,
  pausedReason: null,
  pausedAt: null,
  rules: null,
  rulesBaseline: null,
  lastRunAt: null,
  lastOutcome: null,
  createdAt: "2026-09-16T00:00:00.000Z",
  updatedAt: "2026-09-16T00:00:00.000Z",
};

function raw(key: string, body = `body ${key}`): RawPosting {
  return { externalKey: key, url: `https://b.example/${key}`, title: `Job ${key}`, company: null, location: null, country: null, workMode: null, postedAt: null, salaryText: null, salary: null, bodyText: body, jsonld: null, lang: null };
}

function deps(existing: Record<string, string> = {}) {
  const store = new Map(Object.entries(existing)); // key → content
  const runs: { outcome: SourceRunOutcome; at: string }[] = [];
  const pauses: PauseReason[] = [];
  let absentCalls = 0;
  const d: ReconcileDeps = {
    upsertPosting: (_s, r) => {
      const prev = store.get(r.externalKey);
      store.set(r.externalKey, r.bodyText);
      return { id: r.externalKey, outcome: prev === undefined ? "new" : prev === r.bodyText ? "unchanged" : "changed" };
    },
    markAbsent: () => {
      absentCalls++;
      return 2;
    },
    recordSourceRun: (_s, outcome, at) => {
      runs.push({ outcome, at });
    },
    pauseSource: (_s, reason) => {
      pauses.push(reason);
    },
  };
  return { d, runs, pauses, absentCalls: () => absentCalls };
}

function adapter(refs: PostingRef[], detail: (ref: PostingRef) => Promise<RawPosting | null>, detailFetches = true): SourceAdapter {
  return {
    name: "board_rules",
    detailFetches,
    async *discover() {
      for (const r of refs) yield r;
    },
    detail,
  };
}

const ctx = (): AdapterContext => ({ source: src, preferences: EMPTY_PREFERENCES, fetch: async () => ({ kind: "gone", status: 404, detail: "unused" }), limits: DEFAULT_ADAPTER_LIMITS, log: () => undefined });

test("succeeded: new/changed/unchanged counted, absent measured, run recorded, nothing paused", async () => {
  const { d, runs, pauses } = deps({ a: "body a", b: "old b" });
  const refs = ["a", "b", "c"].map((k) => ({ externalKey: k, url: `https://b.example/${k}` }));
  const summary = await reconcileSource(src, adapter(refs, async (r) => raw(r.externalKey)), ctx(), d);
  assert.deepEqual(summary, { sourceId: "jss-1", outcome: "succeeded", new: 1, changed: 1, unchanged: 1, absent: 2, reason: null });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].outcome, "succeeded");
  assert.deepEqual(pauses, []);
});

test("collapsed: AdapterCollapsed → collapsed + pauseSource(collapsed); nothing marked absent", async () => {
  const { d, runs, pauses, absentCalls } = deps();
  const a: SourceAdapter = {
    name: "board_rules",
    detailFetches: true,
    async *discover() {
      throw new AdapterCollapsed("required_rule_miss", "page 1: no match for url");
    },
    detail: async () => null,
  };
  const summary = await reconcileSource(src, a, ctx(), d);
  assert.equal(summary.outcome, "collapsed");
  assert.equal(summary.reason, "required_rule_miss");
  assert.deepEqual(pauses, ["collapsed"]);
  assert.equal(absentCalls(), 0);
  assert.equal(runs[0].outcome, "collapsed");
});

test("blocked anywhere: the source stops at the first denial, is paused as blocked, later refs are not fetched", async () => {
  const { d, pauses, absentCalls } = deps();
  const refs = ["a", "b", "c"].map((k) => ({ externalKey: k, url: `https://b.example/${k}` }));
  let detailCalls = 0;
  const summary = await reconcileSource(
    src,
    adapter(refs, async (r) => {
      detailCalls++;
      if (r.externalKey === "b") throw new FetchHalt({ kind: "blocked", status: 403, detail: "http_403" });
      return raw(r.externalKey);
    }),
    ctx(),
    d
  );
  assert.equal(summary.outcome, "blocked");
  assert.equal(summary.reason, "blocked");
  assert.equal(summary.new, 1, "what landed before the denial stays");
  assert.equal(detailCalls, 2, "no second fetch after the 403");
  assert.deepEqual(pauses, ["blocked"]);
  assert.equal(absentCalls(), 0, "a stopped run says nothing about who is gone");
});

test("offline / robots / gone / outage / config → the closed reason vocabulary, no pause", async () => {
  const cases: [FetchFailure, SourceRunOutcome, string][] = [
    [{ kind: "offline", detail: "KP_OFFLINE" }, "offline", "offline"],
    [{ kind: "robots_disallowed", detail: "/x" }, "failed", "robots_disallowed"],
    [{ kind: "gone", status: 404, detail: "http_404" }, "failed", "source_gone"],
    [{ kind: "outage", status: 503, detail: "http_503" }, "failed", "source_outage"],
    [{ kind: "outage", detail: "config_missing_token" }, "failed", "config_invalid"],
  ];
  for (const [failure, outcome, reason] of cases) {
    const { d, pauses } = deps();
    const a: SourceAdapter = {
      name: "eures",
      detailFetches: false,
      async *discover() {
        throw new FetchHalt(failure);
      },
      detail: async () => null,
    };
    const s = await reconcileSource(src, a, ctx(), d);
    assert.equal(s.outcome, outcome, failure.kind);
    assert.equal(s.reason, reason, failure.kind);
    assert.ok((RECONCILE_REASONS as readonly string[]).includes(s.reason!));
    assert.deepEqual(pauses, []);
  }
});

test("an unexpected adapter throw → failed/adapter_error (logged server-side, code on the wire)", async () => {
  const { d } = deps();
  const realError = console.error;
  const logged: unknown[] = [];
  console.error = (...a: unknown[]) => {
    logged.push(a);
  };
  try {
    const s = await reconcileSource(src, adapter([{ externalKey: "a", url: "u" }], async () => Promise.reject(new TypeError("kaboom"))), ctx(), d);
    assert.equal(s.outcome, "failed");
    assert.equal(s.reason, "adapter_error");
    assert.equal(logged.length, 1);
  } finally {
    console.error = realError;
  }
});

test("the detail budget bounds fetching adapters; a truncated run does NOT mark absent", async () => {
  const { d, absentCalls } = deps();
  const refs = Array.from({ length: 10 }, (_, i) => ({ externalKey: `k${i}`, url: `https://b.example/${i}` }));
  let detailCalls = 0;
  const c = ctx();
  c.limits = { maxRefs: 100, maxDetailFetches: 4 };
  const s = await reconcileSource(
    src,
    adapter(refs, async (r) => {
      detailCalls++;
      return raw(r.externalKey);
    }),
    c,
    d
  );
  assert.equal(s.outcome, "succeeded");
  assert.equal(detailCalls, 4);
  assert.equal(s.new, 4);
  assert.equal(s.absent, 0);
  assert.equal(absentCalls(), 0);
  // A feed adapter (no detail fetches) is not bounded by it.
  const { d: d2, absentCalls: ac2 } = deps();
  const s2 = await reconcileSource(src, adapter(refs, async (r) => raw(r.externalKey), false), c, d2);
  assert.equal(s2.new, 10);
  assert.equal(ac2(), 1);
});

test("hitting maxRefs is a truncated pass - whether reconcile stopped the adapter or the adapter stopped itself - and marks nothing absent", async () => {
  const c = ctx();
  c.limits = { maxRefs: 10, maxDetailFetches: 60 };
  const many = Array.from({ length: 15 }, (_, i) => ({ externalKey: `k${i}`, url: `https://b.example/${i}` }));
  const { d, absentCalls } = deps();
  const s = await reconcileSource(src, adapter(many, async (r) => raw(r.externalKey), false), c, d);
  assert.equal(s.outcome, "succeeded");
  assert.equal(s.new, 10, "the first maxRefs refs are read");
  assert.equal(absentCalls(), 0, "the five refs past the cap are not 'gone'");
  // An adapter that honours maxRefs itself (every ATS adapter: `if (++n >= maxRefs) return`)
  // ends its iterator AT the cap - reconcile cannot tell that from "that was all", so the
  // cap itself is the signal.
  const { d: d2, absentCalls: ac2 } = deps();
  await reconcileSource(src, adapter(many.slice(0, 10), async (r) => raw(r.externalKey), false), c, d2);
  assert.equal(ac2(), 0);
  // Under the cap, the pass is complete and absence is measured.
  const { d: d3, absentCalls: ac3 } = deps();
  await reconcileSource(src, adapter(many.slice(0, 9), async (r) => raw(r.externalKey), false), c, d3);
  assert.equal(ac3(), 1);
});

test("a detail fetch that hit an outage makes the pass incomplete (not absent); a gone detail does not", async () => {
  const refs = ["a", "b", "c"].map((k) => ({ externalKey: k, url: `https://b.example/${k}` }));
  const withDetail = (failure: FetchFailure) =>
    adapter(refs, async (r) => {
      if (r.externalKey !== "b") return raw(r.externalKey);
      // The real adapters route a detail fetch through detailOk: outage/gone -> null.
      const c = ctxSeen;
      return detailOk(failure, c!, r.url) ? raw(r.externalKey) : null;
    });
  let ctxSeen: AdapterContext | null = null;
  const capture = (a: SourceAdapter): SourceAdapter => ({
    ...a,
    detail: (ref, c) => {
      ctxSeen = c;
      return a.detail(ref, c);
    },
  });
  const { d, absentCalls } = deps();
  const s = await reconcileSource(src, capture(withDetail({ kind: "outage", status: 503, detail: "http_503" })), ctx(), d);
  assert.equal(s.outcome, "succeeded");
  assert.equal(s.new, 2);
  assert.equal(absentCalls(), 0, "b could not be read, which says nothing about whether it is gone");
  const { d: d2, absentCalls: ac2 } = deps();
  await reconcileSource(src, capture(withDetail({ kind: "gone", status: 404, detail: "http_404" })), ctx(), d2);
  assert.equal(ac2(), 1, "a 404 detail IS evidence: the pass is complete");
});
