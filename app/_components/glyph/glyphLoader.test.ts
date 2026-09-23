// Traced glyph art loads by id, off the workspace page's import graph.
//
// 274 KB of emitted path data used to ride app/page.tsx's static graph because every
// empty state imported a glyphs/*Glyph.ts module for its value. The art is now served
// by GET /api/glyphs/[id] and fetched through glyphLoader.ts, so:
//
//   - the page graph (as scripts/perf/check-budget.mjs walks it, dynamic import()
//     included) reaches ZERO traced modules and not the server catalog either;
//   - a glyph is fetched at most once per page lifetime, concurrent mounts share one
//     request, and a failure is `null` (the empty-state copy carries the meaning) and
//     is NOT cached, so the next mount retries.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createGlyphLoader, glyphUrl, isTracedGlyph, loadGlyph, peekGlyph } from "./glyphLoader.ts";
import type { GlyphId } from "./glyphRegistry.ts";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

const ART = { viewBox: "0 0 1024 1024", data: [{ d: "M0 0h1v1H0z", fill: "var(--color-paper)", delay: 0 }] };

type FetchStub = typeof fetch & { calls: string[] };

/** A fetch that answers `respond(url)` and records every URL it was asked for. */
function stubFetch(respond: (url: string) => Promise<Response>): FetchStub {
  const calls: string[] = [];
  const fn = ((input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return respond(url);
  }) as FetchStub;
  fn.calls = calls;
  return fn;
}

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

test("walkGraph('app/page.tsx') reaches no traced glyph module and not the server catalog", async () => {
  const budget = pathToFileURL(path.join(REPO_ROOT, "scripts", "perf", "check-budget.mjs")).href;
  const { walkGraph } = (await import(budget)) as {
    walkGraph: (entry: string, root?: string) => { modules: number; files: Set<string> };
  };
  const graph = walkGraph(path.join(REPO_ROOT, "app", "page.tsx"), REPO_ROOT);
  const rel = [...graph.files].map((f) => path.relative(REPO_ROOT, f).split(path.sep).join("/"));
  // Self-check: the walk really covered the workspace, including the renderer and
  // the loader — an empty walk would pass the real assertion vacuously.
  assert.ok(graph.modules > 500, `expected the workspace graph, walked ${graph.modules} modules`);
  assert.ok(rel.includes("app/_components/glyph/MotionizedGlyph.tsx"), "MotionizedGlyph is not on the page graph");
  assert.ok(rel.includes("app/_components/glyph/glyphLoader.ts"), "glyphLoader is not on the page graph");

  const traced = rel.filter((f) => /^app\/_components\/glyph\/glyphs\/[^/]+Glyph\.ts$/.test(f));
  assert.deepEqual(traced, [], `traced art on the page graph: ${traced.join(", ")}`);
  assert.ok(!rel.includes("app/_components/glyph/glyphCatalog.ts"), "the server catalog is on the page graph");
});

test("glyphUrl maps a GlyphId to its route and an unknown string to null", () => {
  assert.equal(glyphUrl("decisions"), "/api/glyphs/decisions");
  assert.equal(glyphUrl("channelComms"), "/api/glyphs/channelComms");
  assert.equal(glyphUrl("nope" as GlyphId), null);
  assert.equal(glyphUrl("constructor" as GlyphId), null);
  // Type level: tsc fails this file if glyphUrl ever widens to accept any string.
  type Accepts<T> = T extends Parameters<typeof glyphUrl>[0] ? true : false;
  const rejectsStranger: Accepts<"nope"> = false;
  const acceptsId: Accepts<"decisions"> = true;
  assert.deepEqual([rejectsStranger, acceptsId], [false, true]);
});

test("two concurrent loads share ONE request and resolve to the same object; a later load issues none", async () => {
  let release: (r: Response) => void = () => {};
  const fetchStub = stubFetch(() => new Promise<Response>((r) => (release = r)));
  const loader = createGlyphLoader(() => fetchStub);
  const a = loader.load("jobs");
  const b = loader.load("jobs");
  assert.equal(fetchStub.calls.length, 1);
  assert.deepEqual(fetchStub.calls, ["/api/glyphs/jobs"]);
  release(new Response(JSON.stringify(ART), { status: 200 }));
  const [ga, gb] = await Promise.all([a, b]);
  assert.ok(ga);
  assert.equal(ga, gb);
  assert.deepEqual(ga, ART);
  assert.equal(loader.peek("jobs"), ga, "a resolved glyph is readable synchronously");
  const again = await loader.load("jobs");
  assert.equal(again, ga);
  assert.equal(fetchStub.calls.length, 1, "a resolved glyph issued a second request");
});

test("a rejected fetch resolves null, never throws, and the next load retries", async () => {
  let fail = true;
  const fetchStub = stubFetch(() => (fail ? Promise.reject(new TypeError("offline")) : ok(ART)));
  const loader = createGlyphLoader(() => fetchStub);
  assert.equal(await loader.load("library"), null);
  assert.equal(loader.peek("library"), undefined);
  fail = false;
  assert.deepEqual(await loader.load("library"), ART);
  assert.equal(fetchStub.calls.length, 2, "the failure was cached instead of retried");
});

test("a 404 resolves null and is retried, not cached", async () => {
  const fetchStub = stubFetch(() =>
    Promise.resolve(new Response(JSON.stringify({ error: "x", code: "GLYPH_UNKNOWN" }), { status: 404 })),
  );
  const loader = createGlyphLoader(() => fetchStub);
  assert.equal(await loader.load("matrix"), null);
  assert.equal(await loader.load("matrix"), null);
  assert.equal(fetchStub.calls.length, 2);
});

test("a body that is not a TracedGlyph resolves null and is retried", async () => {
  const bodies: unknown[] = [
    { viewBox: "0 0 1 1", data: "nope" },
    { viewBox: "0 0 1 1", data: [{ d: "M0 0", fill: "#000" }] },
    { viewBox: "0 0 1 1", data: [{ d: 1, fill: "x", delay: 0 }] },
    { data: [] },
    [],
    null,
  ];
  let i = 0;
  const fetchStub = stubFetch(() => ok(bodies[i++]));
  const loader = createGlyphLoader(() => fetchStub);
  for (let n = 0; n < bodies.length; n++) assert.equal(await loader.load("schedule"), null, `body ${n} was accepted`);
  assert.equal(fetchStub.calls.length, bodies.length);

  const notJson = stubFetch(() => Promise.resolve(new Response("<html>", { status: 200 })));
  assert.equal(await createGlyphLoader(() => notJson).load("schedule"), null);
});

test("an unknown id never reaches the network", async () => {
  const fetchStub = stubFetch(() => ok(ART));
  const loader = createGlyphLoader(() => fetchStub);
  assert.equal(await loader.load("nope"), null);
  assert.equal(fetchStub.calls.length, 0);
});

test("isTracedGlyph accepts the emitted shape", () => {
  assert.equal(isTracedGlyph(ART), true);
  assert.equal(isTracedGlyph({ viewBox: "0 0 1 1", data: [] }), true);
  assert.equal(isTracedGlyph({ viewBox: 1, data: [] }), false);
});

test("the default loader reads globalThis.fetch at call time", async () => {
  const original = globalThis.fetch;
  const fetchStub = stubFetch(() => ok(ART));
  globalThis.fetch = fetchStub;
  try {
    assert.equal(peekGlyph("devCases"), undefined);
    assert.deepEqual(await loadGlyph("devCases"), ART);
    assert.deepEqual(peekGlyph("devCases"), ART);
    assert.deepEqual(fetchStub.calls, ["/api/glyphs/devCases"]);
  } finally {
    globalThis.fetch = original;
  }
});
