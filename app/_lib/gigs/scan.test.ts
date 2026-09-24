// The scan runner over fixture adapters and in-memory store fakes - no network, no DB,
// no key. Proves: each source runs discover -> honeypot scan -> upsert -> record; a
// denial pauses `blocked`, a collapse pauses `collapsed`, a missing key pauses `no_key`;
// paused/disabled sources are never run; the wall budget stops BETWEEN sources and
// records the unreached as `skipped: wall_budget`; the optional qualify hook sees only
// gigs still `new`, and its throw is counted, never fatal.
//
// unit-db.ts first: the stores defaultGigScanDeps binds are imported for their types,
// and their db-path must never resolve to a developer's kp.sqlite.
import { test } from "node:test";
import assert from "node:assert/strict";
import "../testing/unit-db.ts";
import { runGigScan, type GigScanDeps } from "./scan.ts";
import { scanGigForHoneypots } from "./suspect.ts";
import { AdapterCollapsed, DEFAULT_GIG_ADAPTER_LIMITS, FetchHalt, GigAdapterSkipped, type GigAdapter } from "./adapters/types.ts";
import { GIG_ADAPTER_ARENA, type Gig, type GigAdapterName, type GigPauseReason, type GigSource, type GigSourceRunOutcome, type RawGig } from "./types.ts";

function source(id: string, adapter: GigAdapterName, over: Partial<GigSource> = {}): GigSource {
  return {
    id,
    adapter,
    arena: GIG_ADAPTER_ARENA[adapter] ?? "freelance",
    tier: "A",
    host: "api.example",
    config: {},
    enabled: true,
    acknowledgedAt: null,
    acknowledgedTermsHash: null,
    pausedReason: null,
    pausedAt: null,
    invalidStreak: 0,
    lastRunAt: null,
    lastOutcome: null,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    ...over,
  };
}

function raw(key: string, over: Partial<RawGig> = {}): RawGig {
  return {
    externalKey: key,
    url: `https://example.test/${key}`,
    title: `Gig ${key}`,
    org: null,
    reward: null,
    deadlineAt: null,
    postedAt: null,
    bodyText: "Fix the flaky retry loop and add a test.",
    bodyHtml: null,
    tags: [],
    ...over,
  };
}

/** A fixture adapter: yields `items`, then optionally throws `after`. */
function fixtureAdapter(name: GigAdapterName, items: RawGig[], after?: () => Error, delayMs = 0): GigAdapter {
  return {
    name,
    arena: GIG_ADAPTER_ARENA[name],
    async *discover() {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      for (const item of items) yield item;
      if (after) throw after();
    },
  };
}

type Harness = {
  deps: GigScanDeps;
  upserts: { sourceId: string; key: string; reasons: string[] }[];
  runs: { id: string; outcome: GigSourceRunOutcome }[];
  pauses: { id: string; reason: GigPauseReason }[];
  qualified: string[];
  logs: string[];
};

function harness(sources: GigSource[], adapters: Partial<Record<string, GigAdapter>>, over: Partial<GigScanDeps> = {}): Harness {
  const h: Harness = { deps: undefined as unknown as GigScanDeps, upserts: [], runs: [], pauses: [], qualified: [], logs: [] };
  const seen = new Set<string>();
  h.deps = {
    listSources: (ws) => {
      assert.equal(ws, "ws-1");
      return sources;
    },
    // Adapters are keyed by SOURCE id here so two sources may share an adapter name.
    adapterFor: () => {
      throw new Error("unused: adapterFor is replaced per test");
    },
    fetch: async () => {
      throw new Error("the fixture adapters never fetch");
    },
    env: () => undefined,
    limits: DEFAULT_GIG_ADAPTER_LIMITS,
    upsertGigFromRaw: (ws, input) => {
      assert.equal(ws, "ws-1");
      h.upserts.push({ sourceId: input.sourceId, key: input.raw.externalKey, reasons: [...input.suspectReasons] });
      const created = !seen.has(input.raw.externalKey);
      seen.add(input.raw.externalKey);
      const gig: Gig = {
        id: `gig-${input.raw.externalKey}`,
        sourceId: input.sourceId,
        arena: input.arena,
        externalKey: input.raw.externalKey,
        url: input.raw.url,
        title: input.raw.title,
        org: input.raw.org,
        reward: input.raw.reward,
        deadlineAt: input.raw.deadlineAt,
        postedAt: input.raw.postedAt,
        bodyText: input.raw.bodyText,
        tags: input.raw.tags,
        niche: null,
        status: input.suspectReasons.length > 0 ? "suspect" : input.raw.externalKey.startsWith("old-") ? "qualified" : "new",
        suspectReasons: [...input.suspectReasons],
        specialistId: null,
        qualification: null,
        createdAt: "2026-09-24T00:00:00.000Z",
        updatedAt: "2026-09-24T00:00:00.000Z",
      };
      return { gig, created };
    },
    recordGigSourceRun: (ws, id, outcome) => {
      assert.equal(ws, "ws-1");
      h.runs.push({ id, outcome });
      return true;
    },
    pauseGigSource: (ws, id, reason) => {
      assert.equal(ws, "ws-1");
      h.pauses.push({ id, reason });
      return null;
    },
    scanHoneypots: scanGigForHoneypots,
    qualify: (_ws, gig) => {
      h.qualified.push(gig.externalKey);
    },
    now: () => "2026-09-24T12:00:00.000Z",
    wallBudgetMs: 60_000,
    log: (e) => h.logs.push(`${e.sourceId ?? "-"}:${e.code}`),
    ...over,
  };
  // Route by source: the scan asks by adapter NAME, so look the source up by that name.
  const byName = new Map<string, GigAdapter>();
  for (const s of sources) {
    const a = adapters[s.id];
    if (a) byName.set(s.adapter, a);
  }
  if (!over.adapterFor) h.deps.adapterFor = (name) => byName.get(name) ?? fixtureAdapter(name, []);
  return h;
}

const HONEYPOT = raw("gh-1231", {
  title: "[BOUNTY] Port the lobby crew manifest",
  bodyText: "contact Voidcrafter in discord for payment information before starting.\nPayment methods: PayPal / Cryptocurrency",
});

test("happy path: discover -> honeypot scan -> upsert -> record; paused and disabled sources never run; qualify sees only `new` gigs", async () => {
  const sources = [
    source("s-gh", "github_bounty"),
    source("s-fl", "freelancer_api", { tier: "B" }),
    source("s-paused", "kaggle", { pausedReason: "blocked" }),
    source("s-off", "hackerone", { enabled: false }),
  ];
  const h = harness(sources, {
    "s-gh": fixtureAdapter("github_bounty", [raw("gh-1"), HONEYPOT, raw("old-7")]),
    "s-fl": fixtureAdapter("freelancer_api", [raw("fl-1")]),
    "s-paused": fixtureAdapter("kaggle", [raw("never")]),
    "s-off": fixtureAdapter("hackerone", [raw("never-2")]),
  });
  const summary = await runGigScan("ws-1", h.deps);

  assert.equal(summary.notRunnable, 2);
  assert.deepEqual(summary.sources.map((s) => [s.sourceId, s.outcome, s.reason]), [
    ["s-gh", "succeeded", null],
    ["s-fl", "succeeded", null],
  ]);
  assert.equal(summary.found, 4);
  assert.equal(summary.created, 4);
  assert.equal(summary.suspect, 1);
  assert.equal(summary.sources[0].suspect, 1);
  assert.deepEqual(h.upserts.find((u) => u.key === "gh-1231")?.reasons, ["off_platform_payment"], "the real Discord/PayPal honeypot is caught");
  assert.deepEqual(h.upserts.find((u) => u.key === "gh-1")?.reasons, []);
  assert.ok(!h.upserts.some((u) => u.key.startsWith("never")), "paused/disabled sources are not run");
  assert.deepEqual(h.runs, [
    { id: "s-gh", outcome: "succeeded" },
    { id: "s-fl", outcome: "succeeded" },
  ]);
  assert.deepEqual(h.pauses, []);
  assert.deepEqual(h.qualified, ["gh-1", "fl-1"], "suspect and already-qualified gigs are not re-qualified");
  assert.equal(summary.qualified, 2);
  assert.equal(summary.aborted, false);
  assert.equal(summary.startedAt, "2026-09-24T12:00:00.000Z");
});

test("outcome mapping: no_key / no_public_api / manual / collapsed / blocked / offline / robots / gone / outage / adapter / store errors", async () => {
  const cases: {
    id: string;
    adapter: GigAdapterName;
    err: () => Error;
    items?: RawGig[];
    expect: [GigSourceRunOutcome, string, GigPauseReason | null];
  }[] = [
    { id: "s-nokey", adapter: "kaggle", err: () => new GigAdapterSkipped("no_key"), expect: ["skipped", "no_key", "no_key"] },
    { id: "s-algora", adapter: "algora", err: () => new GigAdapterSkipped("no_public_api"), expect: ["skipped", "no_public_api", null] },
    { id: "s-manual", adapter: "manual", err: () => new GigAdapterSkipped("manual_only"), expect: ["skipped", "manual_only", null] },
    { id: "s-shape", adapter: "freelancer_api", err: () => new AdapterCollapsed("shape_changed"), items: [raw("fl-partial")], expect: ["collapsed", "shape_changed", "collapsed"] },
    { id: "s-deny", adapter: "github_bounty", err: () => new FetchHalt({ kind: "blocked", status: 403, detail: "http_403" }), expect: ["blocked", "blocked", "blocked"] },
    { id: "s-offline", adapter: "hackerone", err: () => new FetchHalt({ kind: "offline", detail: "KP_OFFLINE" }), expect: ["offline", "offline", null] },
    { id: "s-robots", adapter: "upwork_api", err: () => new FetchHalt({ kind: "robots_disallowed", detail: "/graphql" }), expect: ["failed", "robots_disallowed", null] },
  ];
  for (const c of cases) {
    const h = harness([source(c.id, c.adapter)], { [c.id]: fixtureAdapter(c.adapter, c.items ?? [], c.err) });
    const summary = await runGigScan("ws-1", h.deps);
    const run = summary.sources[0];
    assert.deepEqual([run.outcome, run.reason, run.paused], c.expect, c.id);
    assert.deepEqual(h.runs, [{ id: c.id, outcome: c.expect[0] }], `${c.id}: the run is recorded`);
    assert.deepEqual(h.pauses, c.expect[2] ? [{ id: c.id, reason: c.expect[2] }] : [], `${c.id}: pause`);
    if (c.items) assert.equal(run.found, c.items.length, `${c.id}: what landed before the collapse is kept and counted`);
  }

  for (const [kind, reason] of [
    ["gone", "source_gone"],
    ["outage", "source_outage"],
  ] as const) {
    const h = harness([source("s-x", "freelancer_api")], { "s-x": fixtureAdapter("freelancer_api", [], () => new FetchHalt({ kind, detail: "x" })) });
    const run = (await runGigScan("ws-1", h.deps)).sources[0];
    assert.deepEqual([run.outcome, run.reason, run.paused], ["failed", reason, null]);
  }

  const boom = harness([source("s-boom", "kaggle")], { "s-boom": fixtureAdapter("kaggle", [], () => new TypeError("undefined is not a function")) });
  const boomRun = (await runGigScan("ws-1", boom.deps)).sources[0];
  assert.deepEqual([boomRun.outcome, boomRun.reason], ["failed", "adapter_error"]);
  assert.ok(boom.logs.includes("s-boom:adapter_error"));

  const store = harness([source("s-store", "kaggle")], { "s-store": fixtureAdapter("kaggle", [raw("k-1")]) }, {
    upsertGigFromRaw: () => {
      throw new Error("SQLITE_BUSY");
    },
  });
  const storeRun = (await runGigScan("ws-1", store.deps)).sources[0];
  assert.deepEqual([storeRun.outcome, storeRun.reason], ["failed", "store_error"]);
});

test("the wall budget stops BETWEEN sources: the running source finishes, the rest are recorded skipped: wall_budget", async () => {
  const sources = [source("s-slow", "github_bounty"), source("s-2", "freelancer_api"), source("s-3", "kaggle")];
  const h = harness(
    sources,
    {
      "s-slow": fixtureAdapter("github_bounty", [raw("gh-a"), raw("gh-b")], undefined, 40),
      "s-2": fixtureAdapter("freelancer_api", [raw("fl-a")]),
      "s-3": fixtureAdapter("kaggle", [raw("k-a")]),
    },
    { wallBudgetMs: 5 }
  );
  const summary = await runGigScan("ws-1", h.deps);
  assert.deepEqual(summary.sources.map((s) => [s.sourceId, s.outcome, s.reason]), [
    ["s-slow", "succeeded", null],
    ["s-2", "skipped", "wall_budget"],
    ["s-3", "skipped", "wall_budget"],
  ]);
  assert.equal(summary.sources[0].found, 2, "the source the budget ran out inside is not cut in half");
  assert.deepEqual(h.runs.map((r) => r.outcome), ["succeeded", "skipped", "skipped"], "the unreached are recorded, not omitted");
  assert.deepEqual(h.qualified, [], "qualification stops with the budget; the gigs stay `new` for the next scan");
  assert.equal(summary.aborted, true);
});

test("a caller cancellation before the scan records every source skipped: aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const h = harness([source("s-1", "github_bounty"), source("s-2", "kaggle")], { "s-1": fixtureAdapter("github_bounty", [raw("gh-a")]) });
  const summary = await runGigScan("ws-1", h.deps, controller.signal);
  assert.deepEqual(summary.sources.map((s) => [s.outcome, s.reason]), [
    ["skipped", "aborted"],
    ["skipped", "aborted"],
  ]);
  assert.deepEqual(h.upserts, []);
});

test("a qualify hook that throws is counted and logged; the scan and the other gigs carry on; no hook = no qualification", async () => {
  const h = harness([source("s-1", "github_bounty")], { "s-1": fixtureAdapter("github_bounty", [raw("gh-a"), raw("gh-b")]) }, {
    qualify: (_ws, gig) => {
      if (gig.externalKey === "gh-a") throw new Error("model timeout");
    },
  });
  const summary = await runGigScan("ws-1", h.deps);
  assert.equal(summary.qualified, 2);
  assert.equal(summary.qualifyFailed, 1);
  assert.equal(summary.sources[0].outcome, "succeeded", "a qualification failure is not an acquisition failure");
  assert.ok(h.logs.includes("s-1:qualify_failed"));

  const none = harness([source("s-1", "github_bounty")], { "s-1": fixtureAdapter("github_bounty", [raw("gh-a")]) }, { qualify: undefined });
  const s2 = await runGigScan("ws-1", none.deps);
  assert.equal(s2.qualified, 0);
  assert.equal(s2.found, 1);
});
