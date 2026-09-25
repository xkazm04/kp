// Every adapter against its fixture through a scripted PoliteFetch — no network, no
// DB. Proves: JSON-LD → RawPosting with the salary parsed; sitemap refs are capped;
// a required-rule miss on an `ok` listing page is AdapterCollapsed; feeds map their
// items; the streaming JSON reader never needs the whole file; KP_OFFLINE yields
// `offline` with ZERO fetch calls for every adapter in the registry.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EMPTY_PREFERENCES, SOURCE_ADAPTERS, type ExtractionRule, type JobseekerSource, type RawPosting } from "../types.ts";
import { politeFetch, _resetPolitenessForTests, _setPoliteFetchDepsForTests, type FetchOutcome, type PoliteFetch } from "../fetch/politeFetch.ts";
import { adapterFor, hostForAdapter } from "./registry.ts";
import { AdapterCollapsed, DEFAULT_ADAPTER_LIMITS, FetchHalt, type AdapterContext, type PostingRef } from "./types.ts";
import { readJsonArrayStream } from "./jsonArrayStream.ts";
import { rawFromDetailPage } from "./jsonld.ts";
import { atsDiscover } from "./ats/discover.ts";
import { mpsvItemToRaw } from "./mpsvBulk.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__");
const fx = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");

function source(over: Partial<JobseekerSource> = {}): JobseekerSource {
  return {
    id: "jss-test",
    kind: "board",
    adapter: "board_rules",
    tier: "B",
    host: "www.jobs.example",
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
    ...over,
  };
}

type Script = Record<string, FetchOutcome | ((url: string) => FetchOutcome)>;

/** A PoliteFetch that answers from a script and records every call; `*` catches all. */
function scripted(script: Script) {
  const calls: string[] = [];
  const fetch: PoliteFetch = async (url) => {
    calls.push(url);
    const hit = script[url] ?? script["*"];
    if (!hit) return { kind: "gone", status: 404, detail: "unscripted" };
    return typeof hit === "function" ? hit(url) : hit;
  };
  return { fetch, calls };
}

const ok = (body: string, contentType = "text/html", finalUrl = ""): FetchOutcome => ({ kind: "ok", status: 200, contentType, body, finalUrl, stream: null });

function ctxFor(src: JobseekerSource, fetch: PoliteFetch, limits = DEFAULT_ADAPTER_LIMITS, logs: string[] = []): AdapterContext {
  return { source: src, preferences: { ...EMPTY_PREFERENCES }, fetch, limits, log: (e) => logs.push(`${e.level}:${e.code}`) };
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

test("registry: every adapter name resolves, and hostForAdapter derives the politeness host from config", () => {
  for (const name of SOURCE_ADAPTERS) assert.equal(adapterFor(name).name, name);
  assert.equal(hostForAdapter("ats_greenhouse", { token: "acme" }), "boards-api.greenhouse.io");
  assert.equal(hostForAdapter("ats_greenhouse", {}), null, "no token → no host → the route refuses the create");
  assert.equal(hostForAdapter("ats_recruitee", { company: "acme" }), "acme.recruitee.com");
  assert.equal(hostForAdapter("ats_lever", { site: "acme", eu: true }), "api.eu.lever.co");
  assert.equal(hostForAdapter("board_rules", { listingUrls: ["https://www.jobs.example/prace/?page={page}"] }), "www.jobs.example");
  assert.equal(hostForAdapter("board_sitemap_jsonld", { sitemapUrl: "https://www.startupjobs.example/offers.xml" }), "www.startupjobs.example");
  assert.equal(hostForAdapter("mpsv_bulk", {}), "data.mpsv.cz");
});

test("JSON-LD detail page → RawPosting with the baseSalary parsed (min/max/currency/period), location and @graph handled", () => {
  const raw = rawFromDetailPage("https://www.prace.example/nabidka/1700123456/", fx("prace-detail-jsonld.html"));
  assert.equal(raw.title, "Backend vývojář (Node.js)");
  assert.equal(raw.company, "Fintech Morava s.r.o.");
  assert.equal(raw.location, "Brno");
  assert.equal(raw.country, "cz");
  assert.equal(raw.externalKey, "1700123456", "the JSON-LD identifier is the key");
  assert.deepEqual(raw.salary, { min: 70000, max: 95000, currency: "CZK", period: "month" });
  assert.equal(raw.postedAt, "2026-09-10T00:00:00.000Z");
  assert.equal(raw.workMode, "hybrid", "the body says hybridní");
  assert.match(raw.bodyText, /Požadujeme\nNode\.js a TypeScript/);
  assert.equal(raw.lang, "cs");
  assert.ok(raw.jsonld && raw.jsonld["@type"] === "JobPosting");
  // No JSON-LD: <title> + readable text, the URL is the key.
  const plain = rawFromDetailPage("https://x.example/j/1", "<html lang=\"en\"><head><title>QA Engineer – X</title></head><body><p>Remote role. Cypress.</p></body></html>");
  assert.equal(plain.title, "QA Engineer – X");
  assert.equal(plain.externalKey, "https://x.example/j/1");
  assert.equal(plain.salary, null, "no stated pay stays null — never invented");
  assert.equal(plain.workMode, "remote");
});

test("board_sitemap_jsonld: refs are capped at maxRefs; detail maps the JSON-LD page", async () => {
  const { fetch, calls } = scripted({
    "https://www.startupjobs.example/offers.xml": ok(fx("startupjobs-offers.xml"), "application/xml"),
    "*": ok(fx("prace-detail-jsonld.html")),
  });
  const src = source({ adapter: "board_sitemap_jsonld", host: "www.startupjobs.example", config: { sitemapUrl: "https://www.startupjobs.example/offers.xml" } });
  const adapter = adapterFor("board_sitemap_jsonld");
  const refs = await collect(adapter.discover(ctxFor(src, fetch, { maxRefs: 3, maxDetailFetches: 10 })));
  assert.equal(refs.length, 3, "five <loc>s in the sitemap, three allowed");
  assert.equal(refs[0].url, "https://www.startupjobs.example/nabidka/90001/frontend-developer-react");
  assert.equal(calls.length, 1, "discovery fetched only the sitemap");
  const raw = await adapter.detail(refs[0], ctxFor(src, fetch));
  assert.ok(raw);
  assert.equal(raw!.url, refs[0].url, "the sitemap URL is the posting's URL");
  assert.deepEqual(raw!.salary, { min: 70000, max: 95000, currency: "CZK", period: "month" });
  // A sitemap index fans out to its children.
  const index = scripted({
    "https://b.example/sitemap.xml": ok('<sitemapindex><sitemap><loc>https://b.example/s1.xml</loc></sitemap><sitemap><loc>https://b.example/s2.xml</loc></sitemap></sitemapindex>', "application/xml"),
    "https://b.example/s1.xml": ok("<urlset><url><loc>https://b.example/j/1</loc></url></urlset>", "application/xml"),
    "https://b.example/s2.xml": ok("<urlset><url><loc>https://b.example/j/2</loc></url></urlset>", "application/xml"),
  });
  const fan = await collect(adapter.discover(ctxFor(source({ adapter: "board_sitemap_jsonld", config: { sitemapUrl: "https://b.example/sitemap.xml" } }), index.fetch)));
  assert.deepEqual(fan.map((r) => r.url), ["https://b.example/j/1", "https://b.example/j/2"]);
  // A blocked detail halts the source; a gone detail skips the posting.
  const halting = scripted({ "*": { kind: "blocked", status: 403, detail: "http_403" } });
  await assert.rejects(adapter.detail(refs[0], ctxFor(src, halting.fetch)), FetchHalt);
  const gone = scripted({ "*": { kind: "gone", status: 404, detail: "http_404" } });
  assert.equal(await adapter.detail(refs[0], ctxFor(src, gone.fetch)), null);
});

test("board_rules: listing → refs via the rules; a required-rule miss on an ok page → AdapterCollapsed", async () => {
  const rules = JSON.parse(fx("jobscz-rules.json")) as ExtractionRule[];
  const listingUrl = "https://www.jobs.example/prace/praha/?q=it&page=1";
  const { fetch, calls } = scripted({
    [listingUrl]: ok(fx("jobscz-listing.html")),
    "https://www.jobs.example/prace/praha/?q=it&page=2": ok(fx("jobscz-listing.html").replace(/<article[\s\S]*<\/article>/, "")),
    "*": ok(fx("prace-detail-jsonld.html")),
  });
  const src = source({ rules, config: { listingUrls: ["https://www.jobs.example/prace/praha/?q=it&page={page}"], maxPages: 3 } });
  const adapter = adapterFor("board_rules");
  const refs = await collect(adapter.discover(ctxFor(src, fetch)));
  assert.equal(refs.length, 3);
  assert.deepEqual(refs.map((r) => r.externalKey), ["2001001", "2001002", "2001003"]);
  assert.equal(refs[0].url, "https://www.jobs.example/rpd/2001001/?searchId=abc&rps=233");
  assert.equal(refs[0].hint?.title, "Senior Java Developer");
  assert.equal(refs[0].hint?.company, "Banka Alfa, a.s.");
  assert.equal(calls.length, 2, "page 1, then an empty page 2 ends the listing before page 3");
  // Detail: the card's title/company win, the page supplies the body.
  const raw = await adapter.detail(refs[0], ctxFor(src, fetch));
  assert.equal(raw!.title, "Senior Java Developer");
  assert.equal(raw!.company, "Banka Alfa, a.s.");
  assert.equal(raw!.externalKey, "2001001");
  assert.match(raw!.bodyText, /platebních služeb/);

  // The redesign: the page fetches fine, the required rules match nothing.
  const redesigned = scripted({ "*": ok(fx("jobscz-listing.html").replace(/SearchResultCard/g, "Card")) });
  await assert.rejects(collect(adapter.discover(ctxFor(src, redesigned.fetch))), (e: unknown) => e instanceof AdapterCollapsed && e.reason === "required_rule_miss");
  // No rules at all is a config fault, not a collapse.
  await assert.rejects(collect(adapter.discover(ctxFor(source({ config: src.config }), fetch))), FetchHalt);
});

test("eures: POSTs the seeker's keywords/countries, maps items; a response without items is collapsed", async () => {
  let posted: string | null = null;
  const fetch: PoliteFetch = async (url, opts) => {
    posted = opts.body ?? null;
    assert.equal(opts.method, "POST");
    return ok(fx("eures-search.json"), "application/json");
  };
  const src = source({ adapter: "eures", kind: "feed", tier: "A", host: "europa.eu" });
  const ctx = ctxFor(src, fetch);
  ctx.preferences = { ...EMPTY_PREFERENCES, targetTitles: ["Java developer"], countries: ["cz", "de"] };
  const adapter = adapterFor("eures");
  const refs = await collect(adapter.discover(ctx));
  assert.equal(refs.length, 2);
  const body = JSON.parse(posted!) as { keywords: { keyword: string }[]; locationCodes: string[]; resultsPerPage: number };
  assert.deepEqual(body.keywords.map((k) => k.keyword), ["Java developer"]);
  assert.deepEqual(body.locationCodes, ["cz", "de"]);
  assert.equal(body.resultsPerPage, 50);
  const raw = (await adapter.detail(refs[0], ctx))!;
  assert.equal(raw.externalKey, "CZ-MPSV-20260912-000123");
  assert.equal(raw.company, "Banka Alfa, a.s.");
  assert.equal(raw.location, "Praha");
  assert.equal(raw.country, "cz");
  assert.equal(raw.workMode, "hybrid");
  assert.match(raw.bodyText, /Spring Boot/);
  assert.ok(raw.postedAt?.startsWith("2026-09-12"));
  const collapsed = scripted({ "*": ok('{"numberOfResults": 0}', "application/json") });
  await assert.rejects(collect(adapter.discover(ctxFor(src, collapsed.fetch))), (e: unknown) => e instanceof AdapterCollapsed && e.reason === "shape_changed");
});

test("ats_greenhouse and ats_teamtailor map their feeds; detail completes from the hint without a fetch", async () => {
  const gh = scripted({ "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true": ok(fx("greenhouse-jobs.json"), "application/json") });
  const ghSrc = source({ adapter: "ats_greenhouse", kind: "ats", tier: "A", host: "boards-api.greenhouse.io", config: { token: "acme", company: "Acme" } });
  const ghRefs = await collect(adapterFor("ats_greenhouse").discover(ctxFor(ghSrc, gh.fetch)));
  assert.equal(ghRefs.length, 2);
  const ghRaw = (await adapterFor("ats_greenhouse").detail(ghRefs[0], ctxFor(ghSrc, gh.fetch)))!;
  assert.equal(ghRaw.externalKey, "4400111");
  assert.equal(ghRaw.title, "Senior Backend Engineer (Go)");
  assert.equal(ghRaw.company, "Acme");
  assert.equal(ghRaw.location, "Prague, Czechia");
  assert.match(ghRaw.bodyText, /Requirements\n5\+ years with Go or Java/, "entity-escaped HTML is decoded then stripped");
  assert.equal(ghRaw.workMode, "hybrid");
  assert.equal(gh.calls.length, 1, "detail() fetched nothing");

  const tt = scripted({ "https://nordicwidgets.teamtailor.com/jobs.rss": ok(fx("teamtailor-jobs.rss"), "application/rss+xml") });
  const ttSrc = source({ adapter: "ats_teamtailor", kind: "ats", tier: "A", host: "nordicwidgets.teamtailor.com", config: { company: "nordicwidgets" } });
  const ttRefs = await collect(adapterFor("ats_teamtailor").discover(ctxFor(ttSrc, tt.fetch)));
  assert.equal(ttRefs.length, 2);
  const ttRaw = (await adapterFor("ats_teamtailor").detail(ttRefs[1], ctxFor(ttSrc, tt.fetch)))!;
  assert.equal(ttRaw.externalKey, "teamtailor-job-5502");
  assert.equal(ttRaw.title, "Site Reliability Engineer");
  assert.equal(ttRaw.company, "Nordic Widgets");
  assert.equal(ttRaw.location, "Prague");
  assert.equal(ttRaw.postedAt, "2026-09-10T12:00:00.000Z");
  assert.match(ttRaw.bodyText, /Kubernetes, Terraform, Go/);
});

test("jsonArrayStream: items arrive one by one from a chunked stream, brackets inside strings do not close the array, maxItems cancels", async () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ id: i, nazev: `Pozice ]{ ${i}`, popis: 'text with "quotes" and \\ backslash ]' }));
  const encode = (s: string) => new TextEncoder().encode(s);
  const chunked = (text: string, size: number) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < text.length; i += size) controller.enqueue(encode(text.slice(i, i + size)));
        controller.close();
      },
    });
  const bare = JSON.stringify(items);
  const got: unknown[] = [];
  for await (const it of readJsonArrayStream(chunked(bare, 7))) got.push(it);
  assert.deepEqual(got, items);
  // Object root: the first array that is a direct value of the root.
  const wrapped = JSON.stringify({ meta: { pocet: 40, tags: ["a", "b"] }, polozky: items });
  const got2: unknown[] = [];
  for await (const it of readJsonArrayStream(chunked(wrapped, 13), { arrayKey: "polozky" })) got2.push(it);
  assert.deepEqual(got2, items);
  // Cap.
  const got3: unknown[] = [];
  for await (const it of readJsonArrayStream(chunked(bare, 1000), { maxItems: 5 })) got3.push(it);
  assert.equal(got3.length, 5);
  // The MPSV record mapping keeps the stated pay and never invents one.
  const raw = mpsvItemToRaw({ referencniCislo: "MPSV-1", nazev: "Programátor", zamestnavatel: { nazev: "Firma" }, mistoVykonuPrace: { obec: { nazev: "Brno" } }, mzda: { min: 45000, max: 60000 }, popis: "Java, práce z domova" });
  assert.deepEqual(raw!.salary, { min: 45000, max: 60000, currency: "CZK", period: "month" });
  assert.equal(raw!.workMode, "remote");
  assert.equal(mpsvItemToRaw({ referencniCislo: "MPSV-2", nazev: "X" })!.salary, null);
});

test("mpsv_bulk: streams the file, filters by targets/locations, caps at maxRefs", async () => {
  const records = Array.from({ length: 30 }, (_, i) => ({
    referencniCislo: `R${i}`,
    nazev: i % 2 ? "Java programátor" : "Řidič",
    zamestnavatel: { nazev: "Firma" },
    mistoVykonuPrace: { obec: { nazev: i % 3 ? "Praha" : "Ostrava" } },
    popis: "popis",
  }));
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(JSON.stringify(records)));
      c.close();
    },
  });
  const fetch: PoliteFetch = async (url, opts) => {
    assert.equal(url, "https://data.mpsv.cz/od/soubory/volna-mista/volna-mista.json");
    assert.equal(opts.stream, true, "the bulk file is requested as a stream");
    return { kind: "ok", status: 200, contentType: "application/json", body: "", finalUrl: url, stream };
  };
  const src = source({ adapter: "mpsv_bulk", kind: "feed", tier: "A", host: "data.mpsv.cz" });
  const ctx = ctxFor(src, fetch, { maxRefs: 5, maxDetailFetches: 0 });
  ctx.preferences = { ...EMPTY_PREFERENCES, targetTitles: ["java"], locations: ["Praha"] };
  const refs = await collect(adapterFor("mpsv_bulk").discover(ctx));
  assert.equal(refs.length, 5);
  for (const r of refs) {
    assert.match(r.hint!.title!, /Java/);
    assert.equal(r.hint!.location, "Praha");
  }
});

test("eures: the city filter lets through a posting in a named country and a stated-remote one", async () => {
  const src = source({ adapter: "eures", kind: "feed", tier: "A", host: "europa.eu" });
  const run = async (over: Partial<typeof EMPTY_PREFERENCES>) => {
    const ctx = ctxFor(src, async () => ok(fx("eures-search.json"), "application/json"));
    ctx.preferences = { ...EMPTY_PREFERENCES, countries: ["cz"], ...over };
    return (await collect(adapterFor("eures").discover(ctx))).map((r) => r.hint!.location);
  };
  // The Dresden fixture says "Homeoffice möglich", so it states remote.
  assert.deepEqual(await run({ locations: ["Praha"], workModes: ["hybrid"] }), ["Praha"], "remote ruled out, and neither Dresden nor de was named");
  assert.deepEqual(await run({ locations: ["Praha"], workModes: ["hybrid"], countries: ["cz", "de"] }), ["Praha", "Dresden"], "de was named: Dresden is in the market");
  assert.deepEqual(await run({ locations: ["Praha"] }), ["Praha", "Dresden"], "no work mode named: a stated-remote posting is reachable from Praha");
});

test("mpsv_bulk: a stated-remote posting outside the seeker's city is kept; titles match whole words", async () => {
  const records = [
    { referencniCislo: "R1", nazev: "Java programátor", mistoVykonuPrace: { obec: { nazev: "Ostrava" } }, popis: "Práce z domova, 100% remote." },
    { referencniCislo: "R2", nazev: "Java programátor", mistoVykonuPrace: { obec: { nazev: "Ostrava" } }, popis: "Na pracovišti." },
    { referencniCislo: "R3", nazev: "JavaScript kodér", mistoVykonuPrace: { obec: { nazev: "Praha" } }, popis: "Na pracovišti." },
  ];
  const fetch: PoliteFetch = async (url) => ({
    kind: "ok",
    status: 200,
    contentType: "application/json",
    body: "",
    finalUrl: url,
    stream: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(JSON.stringify(records)));
        c.close();
      },
    }),
  });
  const ctx = ctxFor(source({ adapter: "mpsv_bulk", kind: "feed", tier: "A", host: "data.mpsv.cz" }), fetch, { maxRefs: 50, maxDetailFetches: 0 });
  ctx.preferences = { ...EMPTY_PREFERENCES, targetTitles: ["java"], locations: ["Praha"] };
  const refs = await collect(adapterFor("mpsv_bulk").discover(ctx));
  assert.deepEqual(refs.map((r) => r.externalKey), ["R1"], "R1 states remote; R2 is on-site in Ostrava; R3 is JavaScript, not Java");
  assert.equal(refs[0].hint!.workMode, "remote");
});

test("mpsv_bulk: a stream deadline mid-file is a FetchHalt outage that says how far it got", async () => {
  const records = [0, 1].map((i) => JSON.stringify({ referencniCislo: `R${i}`, nazev: "Java programátor", mistoVykonuPrace: { obec: { nazev: "Praha" } } }));
  let sent = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (!sent) {
        sent = true;
        c.enqueue(new TextEncoder().encode(`[${records.join(",")},`));
        return;
      }
      // What politeFetch's stream deadline raises (and what undici raises on a timed-out signal).
      c.error(Object.assign(new Error("stream idle for 20000 ms"), { name: "TimeoutError" }));
    },
  });
  const fetch: PoliteFetch = async (url) => ({ kind: "ok", status: 200, contentType: "application/json", body: "", finalUrl: url, stream });
  const src = source({ adapter: "mpsv_bulk", kind: "feed", tier: "A", host: "data.mpsv.cz" });
  const ctx = ctxFor(src, fetch, { maxRefs: 50, maxDetailFetches: 0 });
  await assert.rejects(collect(adapterFor("mpsv_bulk").discover(ctx)), (error: unknown) => {
    assert.ok(error instanceof FetchHalt, `a ${String(error)} escaped as-is`);
    assert.equal(error.outcome.kind, "outage");
    assert.match(error.outcome.detail, /2 records read/);
    return true;
  });
});

test("atsDiscover probes each vendor once and reports the hits", async () => {
  const { fetch, calls } = scripted({
    "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true": ok(fx("greenhouse-jobs.json"), "application/json"),
    "https://acme.teamtailor.com/jobs.rss": ok(fx("teamtailor-jobs.rss"), "application/rss+xml"),
    "https://api.lever.co/v0/postings/acme?mode=json": { kind: "blocked", status: 403, detail: "http_403" },
    "*": { kind: "gone", status: 404, detail: "http_404" },
  });
  const { hits, halted } = await atsDiscover("acme", fetch);
  assert.equal(halted, null);
  assert.deepEqual(hits.map((h) => h.adapter), ["ats_greenhouse", "ats_teamtailor"]);
  assert.deepEqual(hits[0].config, { token: "acme" });
  assert.equal(calls.length, 8, "one probe per vendor");
  assert.deepEqual(await atsDiscover("not a slug!", fetch), { hits: [], halted: null });
});

test("KP_OFFLINE: every adapter in the registry yields offline through the REAL politeFetch with zero network calls", async () => {
  process.env.KP_OFFLINE = "1";
  let network = 0;
  _setPoliteFetchDepsForTests({
    fetch: async () => {
      network++;
      return new Response("should never be reached", { status: 200 });
    },
  });
  const rules = JSON.parse(fx("jobscz-rules.json")) as ExtractionRule[];
  const configs: Record<string, Partial<JobseekerSource>> = {
    eures: { config: {} },
    mpsv_bulk: { config: {} },
    ats_greenhouse: { config: { token: "acme" } },
    ats_lever: { config: { site: "acme" } },
    ats_recruitee: { config: { company: "acme" } },
    ats_teamtailor: { config: { company: "acme" } },
    ats_personio: { config: { company: "acme" } },
    ats_workable: { config: { subdomain: "acme" } },
    ats_ashby: { config: { board: "acme" } },
    ats_smartrecruiters: { config: { company: "acme" } },
    board_sitemap_jsonld: { config: { sitemapUrl: "https://www.startupjobs.example/offers.xml" } },
    board_rules: { config: { listingUrls: ["https://www.jobs.example/prace/?page={page}"] }, rules },
  };
  for (const name of SOURCE_ADAPTERS) {
    const src = source({ adapter: name, ...configs[name] });
    const adapter = adapterFor(name);
    let halt: FetchHalt | null = null;
    try {
      await collect(adapter.discover(ctxFor(src, politeFetch)));
    } catch (e) {
      halt = e instanceof FetchHalt ? e : null;
      if (!halt) throw e;
    }
    assert.ok(halt, `${name}: discover must halt`);
    assert.equal(halt!.outcome.kind, "offline", `${name}: the halt is offline`);
  }
  assert.equal(network, 0, "no adapter reached the network");
  const raw: RawPosting | null = await adapterFor("eures").detail({ externalKey: "x", url: "https://e/x" }, ctxFor(source(), politeFetch));
  assert.equal(raw, null, "a feed detail with no hint yields nothing rather than fetching");
});
