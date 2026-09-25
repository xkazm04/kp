// Arbeitnow's public job-board API against inline fixtures through a scripted
// PoliteFetch — no network. Proves: items map to RawPosting (HTML stripped, the board's
// remote flag honoured, pay never guessed); pages are walked until the board says
// there is no next page, bounded by maxRefs and ARBEITNOW_MAX_PAGES; the seeker's
// titles and places filter locally; a payload without `data` is a shape change;
// KP_OFFLINE halts before any network call.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_PREFERENCES, type JobseekerPreferences, type JobseekerSource } from "../types.ts";
import { politeFetch, _resetPolitenessForTests, _setPoliteFetchDepsForTests, type FetchOutcome, type PoliteFetch } from "../fetch/politeFetch.ts";
import { adapterFor, hostForAdapter } from "./registry.ts";
import { ARBEITNOW_HOST, ARBEITNOW_MAX_PAGES, arbeitnowItemToRaw, arbeitnowPageUrl } from "./arbeitnow.ts";
import { AdapterCollapsed, DEFAULT_ADAPTER_LIMITS, FetchHalt, type AdapterContext, type PostingRef } from "./types.ts";

const SRC: JobseekerSource = {
  id: "jss-arbeitnow",
  kind: "feed",
  adapter: "arbeitnow",
  tier: "A",
  host: "www.arbeitnow.com",
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
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
};

const item = (over: Record<string, unknown> = {}) => ({
  slug: "senior-ai-engineer-berlin-1001",
  company_name: "Spree Labs GmbH",
  title: "Senior AI Engineer (LLM)",
  description: "<p><strong>About us</strong></p><p>We build <em>LLM</em> tooling.</p><ul><li>Python</li><li>PyTorch</li></ul>",
  remote: true,
  url: "https://www.arbeitnow.com/jobs/companies/spree-labs/senior-ai-engineer-berlin-1001",
  tags: ["AI", "Python"],
  job_types: ["full time"],
  location: "Berlin",
  created_at: 1790355634,
  ...over,
});

/** The API's envelope: `data`, plus `links.next` while there is another page. */
const page = (data: unknown[], next: boolean) => JSON.stringify({ data, links: { next: next ? "https://www.arbeitnow.com/api/job-board-api?page=99" : null }, meta: { per_page: 250 } });
const ok = (body: string): FetchOutcome => ({ kind: "ok", status: 200, contentType: "application/json", body, finalUrl: "", stream: null });

function run(pages: Record<number, string>, prefs: Partial<JobseekerPreferences> = {}, maxRefs = DEFAULT_ADAPTER_LIMITS.maxRefs) {
  const calls: string[] = [];
  const fetch: PoliteFetch = async (url, opts) => {
    calls.push(url);
    assert.equal(opts.method ?? "GET", "GET");
    const n = Number(new URL(url).searchParams.get("page"));
    return pages[n] ? ok(pages[n]!) : { kind: "gone", status: 404, detail: "unscripted" };
  };
  const ctx: AdapterContext = { source: SRC, preferences: { ...EMPTY_PREFERENCES, ...prefs }, fetch, limits: { ...DEFAULT_ADAPTER_LIMITS, maxRefs }, log: () => undefined };
  return { ctx, calls };
}

async function collect(iter: AsyncIterable<PostingRef>): Promise<PostingRef[]> {
  const out: PostingRef[] = [];
  for await (const r of iter) out.push(r);
  return out;
}

afterEach(() => {
  _resetPolitenessForTests();
  delete process.env.KP_OFFLINE;
});

test("arbeitnow: the registry resolves it and its politeness host is the API's", () => {
  assert.equal(adapterFor("arbeitnow").name, "arbeitnow");
  assert.equal(hostForAdapter("arbeitnow", {}), ARBEITNOW_HOST);
  assert.equal(arbeitnowPageUrl(2), "https://www.arbeitnow.com/api/job-board-api?page=2");
});

test("arbeitnow: an item maps to a RawPosting — HTML stripped, remote from the board's flag, pay never guessed", () => {
  const raw = arbeitnowItemToRaw(item())!;
  assert.equal(raw.externalKey, "senior-ai-engineer-berlin-1001");
  assert.equal(raw.url, "https://www.arbeitnow.com/jobs/companies/spree-labs/senior-ai-engineer-berlin-1001", "the posting links back to Arbeitnow (the terms' attribution)");
  assert.equal(raw.title, "Senior AI Engineer (LLM)");
  assert.equal(raw.company, "Spree Labs GmbH");
  assert.equal(raw.location, "Berlin");
  assert.equal(raw.country, null, "the item states a city, not a country: not derived");
  assert.equal(raw.workMode, "remote");
  assert.equal(raw.postedAt, "2026-09-25T17:00:34.000Z", "created_at is unix seconds");
  assert.equal(raw.salary, null);
  assert.equal(raw.salaryText, null);
  assert.doesNotMatch(raw.bodyText, /<[a-z]/i, "no markup survives");
  assert.match(raw.bodyText, /We build LLM tooling/);
  assert.match(raw.bodyText, /PyTorch/);
});

test("arbeitnow: the board's remote:false outranks a text that merely mentions home office", () => {
  assert.equal(arbeitnowItemToRaw(item({ remote: false, description: "<p>Homeoffice möglich.</p>" }))!.workMode, null, "not remote by the board; the text is not enough to say remote");
  assert.equal(arbeitnowItemToRaw(item({ remote: false, description: "<p>Hybrid: 2 Tage im Büro.</p>" }))!.workMode, "hybrid");
  assert.equal(arbeitnowItemToRaw(item({ remote: false, description: "<p>Vor Ort.</p>" }))!.workMode, null);
});

test("arbeitnow: the operator's national editions are the board too, and their domain names the market", () => {
  const uk = arbeitnowItemToRaw(item({ url: "https://www.arbeitnow.co.uk/jobs/companies/jetbrains/pm-london-1", location: "London" }))!;
  assert.equal(uk.url, "https://www.arbeitnow.co.uk/jobs/companies/jetbrains/pm-london-1");
  assert.equal(uk.country, "gb");
  assert.equal(arbeitnowItemToRaw(item({ url: "https://www.arbeitnow.fr/jobs/companies/x/dev-paris-2", location: "Paris" }))!.country, "fr");
  assert.equal(arbeitnowItemToRaw(item())!.country, null, "the .com edition names no single market");
});

test("arbeitnow: an item without a key, title or its own URL is skipped, not invented", () => {
  assert.equal(arbeitnowItemToRaw(item({ slug: "" })), null);
  assert.equal(arbeitnowItemToRaw(item({ title: null })), null);
  assert.equal(arbeitnowItemToRaw(item({ url: "https://evil.example/x" })), null, "a posting URL off the board's host is not trusted");
});

test("arbeitnow: walks pages until the board says there is no next one; the hint completes detail without a fetch", async () => {
  const { ctx, calls } = run({
    1: page([item(), item({ slug: "b-2", url: "https://www.arbeitnow.com/jobs/b-2" })], true),
    2: page([item({ slug: "c-3", url: "https://www.arbeitnow.com/jobs/c-3" })], false),
  });
  const adapter = adapterFor("arbeitnow");
  const refs = await collect(adapter.discover(ctx));
  assert.deepEqual(refs.map((r) => r.externalKey), ["senior-ai-engineer-berlin-1001", "b-2", "c-3"]);
  assert.deepEqual(calls, [arbeitnowPageUrl(1), arbeitnowPageUrl(2)]);
  const before = calls.length;
  const raw = await adapter.detail(refs[0]!, ctx);
  assert.equal(raw!.title, "Senior AI Engineer (LLM)");
  assert.equal(calls.length, before, "detail fetched nothing");
});

test("arbeitnow: maxRefs and ARBEITNOW_MAX_PAGES bound the walk", async () => {
  const many = (p: number) => page(Array.from({ length: 3 }, (_, i) => item({ slug: `p${p}-${i}`, url: `https://www.arbeitnow.com/jobs/p${p}-${i}` })), true);
  const capped = run({ 1: many(1), 2: many(2) }, {}, 4);
  assert.equal((await collect(adapterFor("arbeitnow").discover(capped.ctx))).length, 4);
  assert.equal(capped.calls.length, 2);
  const pages = Object.fromEntries(Array.from({ length: ARBEITNOW_MAX_PAGES + 3 }, (_, i) => [i + 1, many(i + 1)]));
  const walked = run(pages);
  await collect(adapterFor("arbeitnow").discover(walked.ctx));
  assert.equal(walked.calls.length, ARBEITNOW_MAX_PAGES, "a board that always says 'next' is not read forever");
});

test("arbeitnow: the seeker's titles and places filter locally; a stated-remote posting passes the city filter", async () => {
  const data = [
    item(),
    item({ slug: "acc", title: "Accountant", url: "https://www.arbeitnow.com/jobs/acc" }),
    item({ slug: "muc", title: "AI Engineer", remote: false, location: "Munich", description: "<p>Vor Ort.</p>", url: "https://www.arbeitnow.com/jobs/muc" }),
  ];
  const { ctx } = run({ 1: page(data, false) }, { targetTitles: ["AI Engineer"], locations: ["Praha"] });
  const refs = await collect(adapterFor("arbeitnow").discover(ctx));
  assert.deepEqual(refs.map((r) => r.externalKey), ["senior-ai-engineer-berlin-1001"], "Accountant is off-target; the on-site Munich role is elsewhere");
});

test("arbeitnow: a payload without its data array is a shape change, never zero jobs", async () => {
  for (const body of ['{"message":"Server Error"}', "not json", '{"data":{}}']) {
    const { ctx } = run({ 1: body });
    await assert.rejects(collect(adapterFor("arbeitnow").discover(ctx)), (e: unknown) => e instanceof AdapterCollapsed && e.reason === "shape_changed", body);
  }
});

test("arbeitnow: a refused listing halts the source", async () => {
  const ctx: AdapterContext = { ...run({}).ctx, fetch: async () => ({ kind: "blocked", status: 429, detail: "http_429" }) };
  await assert.rejects(collect(adapterFor("arbeitnow").discover(ctx)), (e: unknown) => e instanceof FetchHalt && e.outcome.kind === "blocked");
});

test("arbeitnow: KP_OFFLINE halts through the real politeFetch before any network call", async () => {
  process.env.KP_OFFLINE = "1";
  let network = 0;
  _setPoliteFetchDepsForTests({
    fetch: async () => {
      network++;
      return new Response("never", { status: 200 });
    },
  });
  const ctx: AdapterContext = { ...run({}).ctx, fetch: politeFetch };
  await assert.rejects(collect(adapterFor("arbeitnow").discover(ctx)), (e: unknown) => e instanceof FetchHalt && e.outcome.kind === "offline");
  assert.equal(network, 0);
});
