// Every gig adapter against its fixture through a scripted PoliteFetch - no network, no
// DB, keys injected through ctx.env. Proves: each provider's JSON -> RawGig with the
// reward read honestly (null when unstated, never 0); a changed shape is
// AdapterCollapsed, never an empty success; a missing key declines BEFORE any fetch; a
// credential rides only as the `authorization` option; KP_OFFLINE yields `offline` with
// ZERO fetch calls for every adapter that would fetch.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GIG_ADAPTER_ARENA, GIG_ADAPTERS, type GigAdapterName, type GigSource, type RawGig } from "../types.ts";
import {
  politeFetch,
  _resetPolitenessForTests,
  _setPoliteFetchDepsForTests,
  type FetchOutcome,
  type PoliteFetch,
  type PoliteFetchOptions,
} from "../../jobseeker/fetch/politeFetch.ts";
import { gigAdapterFor, gigHostForAdapter } from "./registry.ts";
import {
  AdapterCollapsed,
  DEFAULT_GIG_ADAPTER_LIMITS,
  FetchHalt,
  GigAdapterSkipped,
  type GigAdapterContext,
  type GigAdapterLimits,
} from "./types.ts";
import { parseMoney } from "./shared.ts";
import { githubSearchQuery } from "./githubBounty.ts";
import { HACKERONE_PUBLIC_DATASET_URL } from "./hackerone.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__");
const fx = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");

function source(adapter: GigAdapterName, over: Partial<GigSource> = {}): GigSource {
  return {
    id: `gsrc-${adapter}`,
    adapter,
    arena: GIG_ADAPTER_ARENA[adapter] ?? "freelance",
    tier: "A",
    host: gigHostForAdapter(adapter) ?? "manual",
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

type Call = { url: string; opts: PoliteFetchOptions };
type Script = Record<string, FetchOutcome | ((url: string, opts: PoliteFetchOptions) => FetchOutcome)>;

/** A PoliteFetch that answers from a script (exact URL, else `*`) and records every call. */
function scripted(script: Script) {
  const calls: Call[] = [];
  const fetch: PoliteFetch = async (url, opts) => {
    calls.push({ url, opts });
    const hit = script[url] ?? script["*"];
    if (!hit) return { kind: "gone", status: 404, detail: "unscripted" };
    return typeof hit === "function" ? hit(url, opts) : hit;
  };
  return { fetch, calls };
}

const ok = (body: string, contentType = "application/json"): FetchOutcome => ({ kind: "ok", status: 200, contentType, body, finalUrl: "", stream: null });
const okStream = (body: string): FetchOutcome => ({
  kind: "ok",
  status: 200,
  contentType: "text/plain",
  body: "",
  finalUrl: "",
  stream: new Response(body).body,
});

function ctxFor(
  src: GigSource,
  fetch: PoliteFetch,
  opts: { env?: Record<string, string>; limits?: GigAdapterLimits; logs?: string[] } = {}
): GigAdapterContext {
  const env = opts.env ?? {};
  return {
    source: src,
    fetch,
    limits: opts.limits ?? DEFAULT_GIG_ADAPTER_LIMITS,
    env: (name) => env[name],
    log: (e) => opts.logs?.push(`${e.level}:${e.code}`),
  };
}

async function collect(iter: AsyncIterable<RawGig>): Promise<RawGig[]> {
  const out: RawGig[] = [];
  for await (const r of iter) out.push(r);
  return out;
}

afterEach(() => {
  _resetPolitenessForTests();
  delete process.env.KP_OFFLINE;
});

// ---------------------------------------------------------------------------

test("registry: every GIG_ADAPTERS name resolves to its own adapter and arena; hosts are the official API hosts", () => {
  for (const name of GIG_ADAPTERS) {
    const a = gigAdapterFor(name);
    assert.equal(a.name, name);
    assert.equal(a.arena, GIG_ADAPTER_ARENA[name]);
  }
  assert.equal(gigHostForAdapter("github_bounty", {}), "api.github.com");
  assert.equal(gigHostForAdapter("freelancer_api", {}), "www.freelancer.com");
  assert.equal(gigHostForAdapter("kaggle", {}), "www.kaggle.com");
  assert.equal(gigHostForAdapter("hackerone", {}), "api.hackerone.com");
  assert.equal(gigHostForAdapter("upwork_api", {}), "api.upwork.com");
  assert.equal(gigHostForAdapter("algora", {}), "algora.io");
  assert.equal(gigHostForAdapter("manual", {}), null, "a forwarded brief has no source host");
});

test("parseMoney: symbols, codes, k-suffix and the bounty keyword; null when nothing parses; the reward-word guard in prose", () => {
  assert.deepEqual(parseMoney("$500"), { amount: 500, currency: "USD", text: "$500" });
  assert.deepEqual(parseMoney("Bounty 1,000 USD"), { amount: 1000, currency: "USD", text: "1,000 USD" });
  assert.deepEqual(parseMoney("bounty: 1,000"), { amount: 1000, currency: null, text: "bounty: 1,000" });
  assert.deepEqual(parseMoney("€2k prize"), { amount: 2000, currency: "EUR", text: "€2k" });
  assert.deepEqual(parseMoney("EUR 250.50"), { amount: 250.5, currency: "EUR", text: "EUR 250.50" });
  assert.equal(parseMoney("💎 Bounty"), null);
  assert.equal(parseMoney("issue #1234 in v2.3"), null, "a number is not money");
  assert.equal(parseMoney("$0"), null, "zero is not a reward");
  assert.equal(parseMoney("Our server costs $20/month and it keeps crashing.", { requireRewardWord: true }), null);
  assert.deepEqual(parseMoney("A $150 bounty is attached to this.", { requireRewardWord: true }), { amount: 150, currency: "USD", text: "$150" });
});

// ---------------------------------------------------------------------------
// github_bounty
// ---------------------------------------------------------------------------

test("github_bounty: keyless search -> RawGig; reward from a label, from the Algora bot comment, or null; PRs skipped", async () => {
  const { fetch, calls } = scripted({
    "https://api.github.com/repos/calc-org/web/issues/88/comments?per_page=10": ok(fx("github-issue-comments.json")),
    "*": (url) => (url.startsWith("https://api.github.com/search/issues?") ? ok(fx("github-search-issues.json")) : { kind: "gone", status: 404, detail: "unscripted" }),
  });
  const logs: string[] = [];
  const gigs = await collect(gigAdapterFor("github_bounty").discover(ctxFor(source("github_bounty"), fetch, { logs })));
  assert.equal(gigs.length, 3, "four search items, one is a pull request");

  const [retry, picker, splurt] = gigs;
  assert.equal(retry.externalKey, "gh:3100000412");
  assert.equal(retry.url, "https://github.com/acme-oss/uploader/issues/412");
  assert.equal(retry.org, "acme-oss");
  assert.deepEqual(retry.reward, { amount: 500, currency: "USD", text: "$500" }, "the $500 label");
  assert.deepEqual(retry.tags, ["bounty", "$500", "rust"]);
  assert.equal(retry.postedAt, "2026-09-20T08:15:00.000Z");
  assert.equal(retry.deadlineAt, null);
  assert.equal(retry.bodyHtml, null);

  assert.deepEqual(picker.reward, { amount: 300, currency: "USD", text: "$300" }, "read from the algora-pbc[bot] comment, not the human's $50");
  assert.equal(splurt.reward, null, "no amount anywhere and no comments: null, never 0");
  assert.match(splurt.bodyText, /Payment methods: PayPal \/ Cryptocurrency/, "the body is carried verbatim for the honeypot scan");

  // Search once (4 < per_page, so no page 2), one comment read for the one issue that needed it.
  assert.equal(calls.length, 2);
  const search = new URL(calls[0].url);
  assert.equal(search.searchParams.get("q"), "is:issue state:open label:bounty");
  assert.equal(calls[0].opts.authorization, undefined, "keyless: no credential");
  assert.equal(calls[0].opts.sourceId, "gsrc-github_bounty");
  assert.ok(logs.includes("info:github_keyless"));
});

test("github_bounty: a token rides as a bearer; the detail budget bounds the comment reads; labels/query config build the search", async () => {
  const { fetch, calls } = scripted({ "*": (url) => (url.includes("/search/issues") ? ok(fx("github-search-issues.json")) : ok(fx("github-issue-comments.json"))) });
  const gigs = await collect(
    gigAdapterFor("github_bounty").discover(
      ctxFor(source("github_bounty"), fetch, { env: { GH_TOKEN: " ghp_test " }, limits: { maxItems: 100, maxDetailFetches: 0 } })
    )
  );
  assert.equal(calls.length, 1, "a zero detail budget reads no comments");
  assert.equal(calls[0].opts.authorization, "Bearer ghp_test");
  assert.equal(gigs[1].reward, null, "no budget for the bot comment -> null, honestly");
  assert.equal(
    githubSearchQuery({ labels: ["bounty", "💎 Bounty", 'x"y'], query: "language:rust" }),
    'is:issue state:open label:bounty,"💎 Bounty",xy language:rust'
  );
});

test("github_bounty: a search answer without items is a collapse; a 403 rate limit halts as blocked", async () => {
  const collapsed = scripted({ "*": ok(JSON.stringify({ message: "Validation Failed" })) });
  await assert.rejects(collect(gigAdapterFor("github_bounty").discover(ctxFor(source("github_bounty"), collapsed.fetch))), AdapterCollapsed);
  const denied = scripted({ "*": { kind: "blocked", status: 403, detail: "http_403" } });
  await assert.rejects(
    collect(gigAdapterFor("github_bounty").discover(ctxFor(source("github_bounty"), denied.fetch))),
    (e: unknown) => e instanceof FetchHalt && e.outcome.kind === "blocked"
  );
});

// ---------------------------------------------------------------------------
// algora / manual - declined before any network
// ---------------------------------------------------------------------------

test("algora declines no_public_api and manual declines manual_only, both with zero fetch calls", async () => {
  for (const [name, reason] of [
    ["algora", "no_public_api"],
    ["manual", "manual_only"],
  ] as const) {
    const { fetch, calls } = scripted({ "*": ok("[]") });
    await assert.rejects(
      collect(gigAdapterFor(name).discover(ctxFor(source(name), fetch))),
      (e: unknown) => e instanceof GigAdapterSkipped && e.reason === reason
    );
    assert.equal(calls.length, 0, `${name} fetched nothing`);
  }
});

// ---------------------------------------------------------------------------
// kaggle
// ---------------------------------------------------------------------------

test("kaggle: no key -> no_key before any fetch", async () => {
  const { fetch, calls } = scripted({ "*": ok("[]") });
  await assert.rejects(
    collect(gigAdapterFor("kaggle").discover(ctxFor(source("kaggle"), fetch, { env: { KAGGLE_USERNAME: "someone" } }))),
    (e: unknown) => e instanceof GigAdapterSkipped && e.reason === "no_key"
  );
  assert.equal(calls.length, 0);
});

test("kaggle: basic auth; money reward parsed, a Knowledge prize kept as text with amount null; a non-slug ref dropped", async () => {
  const pageOne = (url: string) => (new URL(url).searchParams.get("page") === "1" ? ok(fx("kaggle-competitions-list.json")) : ok("[]"));
  const { fetch, calls } = scripted({ "*": pageOne });
  const gigs = await collect(
    gigAdapterFor("kaggle").discover(
      ctxFor(source("kaggle", { config: { category: "featured", search: "forecast; DROP" } }), fetch, { env: { KAGGLE_USERNAME: "alice", KAGGLE_KEY: "k3y" } })
    )
  );
  assert.equal(gigs.length, 2);
  assert.equal(calls[0].opts.authorization, `Basic ${Buffer.from("alice:k3y").toString("base64")}`);
  const q = new URL(calls[0].url).searchParams;
  assert.equal(q.get("category"), "featured");
  assert.equal(q.get("search"), null, "an unsafe search value is not sent");
  assert.equal(calls.length, 2, "page 2 was empty, so paging stopped");

  const [grid, titanic] = gigs;
  assert.equal(grid.externalKey, "kaggle:grid-load-forecast-2026");
  assert.equal(grid.url, "https://www.kaggle.com/competitions/grid-load-forecast-2026");
  assert.deepEqual(grid.reward, { amount: 50000, currency: "USD", text: "$50,000" });
  assert.equal(grid.deadlineAt, "2026-12-15T23:59:00.000Z");
  assert.equal(grid.org, "Nordic Grid Operators");
  assert.deepEqual(grid.tags, ["Featured", "time series analysis", "tabular"]);
  assert.match(grid.bodyText, /Evaluation metric: Mean Absolute Error/);
  assert.equal(titanic.externalKey, "kaggle:titanic", "an old-API slug ref");
  assert.deepEqual(titanic.reward, { amount: null, currency: null, text: "Knowledge" }, "stated, but not money - never 0");
});

test("kaggle: the kagglesdk `{ competitions }` envelope is read; an unknown shape collapses", async () => {
  const env = { KAGGLE_USERNAME: "a", KAGGLE_KEY: "b" };
  const wrapped = scripted({
    "*": (url) => (new URL(url).searchParams.get("page") === "1" ? ok(JSON.stringify({ competitions: JSON.parse(fx("kaggle-competitions-list.json")) })) : ok(JSON.stringify({ competitions: [] }))),
  });
  assert.equal((await collect(gigAdapterFor("kaggle").discover(ctxFor(source("kaggle"), wrapped.fetch, { env })))).length, 2);
  const broken = scripted({ "*": ok(JSON.stringify({ items: [] })) });
  await assert.rejects(collect(gigAdapterFor("kaggle").discover(ctxFor(source("kaggle"), broken.fetch, { env }))), AdapterCollapsed);
});

// ---------------------------------------------------------------------------
// hackerone
// ---------------------------------------------------------------------------

test("hackerone keyed: open bounty programs only, detail policy + scopes read, reward from the policy", async () => {
  const { fetch, calls } = scripted({
    "https://api.hackerone.com/v1/hackers/programs?page%5Bsize%5D=100": ok(fx("hackerone-programs.json")),
    "https://api.hackerone.com/v1/hackers/programs/acme_cloud": ok(fx("hackerone-program-detail.json")),
  });
  const env = { HACKERONE_API_USERNAME: "hunter", HACKERONE_API_TOKEN: "tok" };
  const gigs = await collect(gigAdapterFor("hackerone").discover(ctxFor(source("hackerone"), fetch, { env })));
  assert.equal(gigs.length, 1, "the VDP pays nothing and the paused program takes no submissions");
  const acme = gigs[0];
  assert.equal(acme.externalKey, "h1:acme_cloud");
  assert.equal(acme.url, "https://hackerone.com/acme_cloud");
  assert.deepEqual(acme.reward, { amount: 15000, currency: "USD", text: "$15,000" });
  assert.deepEqual(acme.tags, ["URL", "GOOGLE_PLAY_APP_ID"]);
  assert.match(acme.bodyText, /In scope:\napi\.acme-cloud\.example/);
  assert.equal(acme.postedAt, "2024-03-01T00:00:00.000Z");
  assert.ok(calls.every((c) => c.opts.authorization === `Basic ${Buffer.from("hunter:tok").toString("base64")}`));
  assert.ok(!calls.some((c) => c.url.includes("raw.githubusercontent.com")), "a keyed run never touches the public dataset");

  const withVdp = scripted({ "*": (url) => (url.includes("programs?") ? ok(fx("hackerone-programs.json")) : { kind: "gone", status: 404, detail: "x" }) });
  const all = await collect(gigAdapterFor("hackerone").discover(ctxFor(source("hackerone", { config: { includeVdp: true } }), withVdp.fetch, { env })));
  assert.deepEqual(all.map((g) => g.externalKey), ["h1:acme_cloud", "h1:quiet_vdp"]);
  assert.equal(all[0].reward, null, "a 404 program detail is skipped, not fatal - and no policy means no amount");
});

test("hackerone keyless: the public dataset is streamed, said in the log, reward null; publicFallback:false -> no_key", async () => {
  const { fetch, calls } = scripted({ [HACKERONE_PUBLIC_DATASET_URL]: () => okStream(fx("hackerone-public-dataset.json")) });
  const logs: string[] = [];
  const gigs = await collect(gigAdapterFor("hackerone").discover(ctxFor(source("hackerone"), fetch, { logs })));
  assert.equal(gigs.length, 1);
  assert.equal(gigs[0].externalKey, "h1:example_payments");
  assert.equal(gigs[0].reward, null, "the dataset has no bounty table");
  assert.deepEqual(gigs[0].tags, ["WILDCARD", "SOURCE_CODE"]);
  assert.match(gigs[0].bodyText, /\*\.payments\.example \(bounty-eligible\)/);
  assert.equal(calls[0].opts.stream, true, "streamed, never buffered");
  assert.equal(calls[0].opts.authorization, undefined);
  assert.ok(logs.includes("info:hackerone_public_dataset"));

  const off = scripted({ "*": ok("[]") });
  await assert.rejects(
    collect(gigAdapterFor("hackerone").discover(ctxFor(source("hackerone", { config: { publicFallback: false } }), off.fetch))),
    (e: unknown) => e instanceof GigAdapterSkipped && e.reason === "no_key"
  );
  assert.equal(off.calls.length, 0);
});

// ---------------------------------------------------------------------------
// freelancer_api
// ---------------------------------------------------------------------------

test("freelancer_api: budget -> reward (minimum, stated range kept), hourly marked, no budget -> null; bid deadline", async () => {
  const { fetch, calls } = scripted({ "*": ok(fx("freelancer-projects-active.json")) });
  const gigs = await collect(gigAdapterFor("freelancer_api").discover(ctxFor(source("freelancer_api", { config: { query: "python", jobs: ["13", "x"] } }), fetch)));
  assert.equal(gigs.length, 3);
  const [scraper, rn, logo] = gigs;
  assert.equal(scraper.externalKey, "fl:40726690");
  assert.equal(scraper.url, "https://www.freelancer.com/projects/python/Python-scraper-for-public-tender");
  assert.deepEqual(scraper.reward, { amount: 250, currency: "USD", text: "$250-$750 USD" });
  assert.deepEqual(scraper.tags, ["Python", "Web Scraping"]);
  assert.equal(scraper.postedAt, new Date(1790070413 * 1000).toISOString());
  assert.equal(scraper.deadlineAt, new Date((1790070413 + 7 * 86400) * 1000).toISOString());
  assert.deepEqual(rn.reward, { amount: 15, currency: "EUR", text: "€15-€25/hr EUR" });
  assert.equal(logo.reward, null, "no budget stated");
  const q = new URL(calls[0].url).searchParams;
  assert.equal(q.get("full_description"), "true");
  assert.equal(q.get("query"), "python");
  assert.deepEqual(q.getAll("jobs[]"), ["13"], "a non-numeric job id is not sent");
  assert.equal(calls[0].opts.authorization, undefined, "keyless public API");
  assert.equal(calls.length, 1, "3 < page size, so no second page");

  const broken = scripted({ "*": ok(JSON.stringify({ status: "error", message: "moved" })) });
  await assert.rejects(collect(gigAdapterFor("freelancer_api").discover(ctxFor(source("freelancer_api"), broken.fetch))), AdapterCollapsed);
});

// ---------------------------------------------------------------------------
// upwork_api
// ---------------------------------------------------------------------------

test("upwork_api: no key -> no_key before any fetch; keyed -> POST GraphQL with a bearer; fixed and hourly rewards", async () => {
  const none = scripted({ "*": ok("{}") });
  await assert.rejects(
    collect(gigAdapterFor("upwork_api").discover(ctxFor(source("upwork_api"), none.fetch))),
    (e: unknown) => e instanceof GigAdapterSkipped && e.reason === "no_key"
  );
  assert.equal(none.calls.length, 0);

  const { fetch, calls } = scripted({ "https://api.upwork.com/graphql": ok(fx("upwork-graphql-jobs.json")) });
  const gigs = await collect(gigAdapterFor("upwork_api").discover(ctxFor(source("upwork_api", { config: { query: "nextjs" } }), fetch, { env: { UPWORK_API_TOKEN: "oauth-abc" } })));
  assert.equal(calls[0].opts.method, "POST");
  assert.equal(calls[0].opts.authorization, "Bearer oauth-abc");
  const body = JSON.parse(calls[0].opts.body ?? "{}");
  assert.match(body.query, /marketplaceJobPostingsSearch/);
  assert.equal(body.variables.filter.searchExpression_eq, "nextjs");
  assert.equal(gigs.length, 2);
  assert.equal(gigs[0].url, "https://www.upwork.com/jobs/~021837451290011234304");
  assert.deepEqual(gigs[0].reward, { amount: 1200, currency: "USD", text: "$1,200.00" });
  assert.deepEqual(gigs[0].tags, ["Web, Mobile & Software Dev", "Web Development", "Next.js", "TypeScript"]);
  assert.deepEqual(gigs[1].reward, { amount: 12, currency: "USD", text: "12-18/hr USD" }, "a $0 fixed amount is not a reward; the hourly band is");
  assert.equal(gigs[1].postedAt, "2026-09-23T15:00:00.000Z");

  const errors = scripted({ "*": ok(JSON.stringify({ errors: [{ message: "Authentication failed" }], data: null })) });
  await assert.rejects(
    collect(gigAdapterFor("upwork_api").discover(ctxFor(source("upwork_api"), errors.fetch, { env: { UPWORK_API_TOKEN: "x" } }))),
    (e: unknown) => e instanceof AdapterCollapsed && /Authentication failed/.test(e.message)
  );
});

// ---------------------------------------------------------------------------
// KP_OFFLINE through the REAL polite door
// ---------------------------------------------------------------------------

test("KP_OFFLINE: every adapter that would fetch halts `offline` with zero network calls", async () => {
  process.env.KP_OFFLINE = "1";
  let network = 0;
  _setPoliteFetchDepsForTests({
    fetch: async () => {
      network++;
      return new Response("{}", { status: 200 });
    },
  });
  const env = {
    KAGGLE_USERNAME: "a",
    KAGGLE_KEY: "b",
    HACKERONE_API_USERNAME: "a",
    HACKERONE_API_TOKEN: "b",
    UPWORK_API_TOKEN: "t",
  };
  for (const name of ["github_bounty", "kaggle", "hackerone", "freelancer_api", "upwork_api"] as const) {
    await assert.rejects(
      collect(gigAdapterFor(name).discover(ctxFor(source(name), politeFetch, { env }))),
      (e: unknown) => e instanceof FetchHalt && e.outcome.kind === "offline",
      name
    );
  }
  // Keyless hackerone goes to the public dataset - also offline, also no network.
  await assert.rejects(collect(gigAdapterFor("hackerone").discover(ctxFor(source("hackerone"), politeFetch))), (e: unknown) => e instanceof FetchHalt);
  assert.equal(network, 0);
});
