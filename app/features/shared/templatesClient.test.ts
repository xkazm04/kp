// `fetchTemplates` must be able to say it FAILED.
//
// It used to `catch { return [] }`, which made "this workspace has no templates"
// and "the template service is down" the same value. Both consumers then drew a
// conclusion from that empty array: the builder quietly offered only the AI
// default format, and the ledger's build-provenance line — whose entire job is to
// say truthfully what produced a JD — printed the "unknown" dash as if the
// template had been deleted. The result carries the reason now, as a CODE, so the
// surfaces resolve it in the reader's language.
import test from "node:test";
import assert from "node:assert/strict";

type FetchLike = typeof globalThis.fetch;
const realFetch = globalThis.fetch;

/** Install a stub fetch for one call. Returns the URLs it was asked for, so the
 *  in-flight coalescing can be observed rather than assumed. */
function stubFetch(handler: (url: string) => Promise<Response> | Response): string[] {
  const seen: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    return Promise.resolve(handler(url));
  }) as FetchLike;
  return seen;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test("a served list comes back with failed = null", async () => {
  const { fetchTemplates } = await import("./templatesClient.ts");
  stubFetch(() => json({ templates: [{ id: "t1", name: "Standard", body: "x", isDefault: 1, scope: "company" }] }));
  const res = await fetchTemplates();
  assert.equal(res.failed, null);
  assert.deepEqual(res.templates.map((t) => t.id), ["t1"]);
});

test("an EMPTY list is a success, not a failure — the two must stay distinguishable", async () => {
  const { fetchTemplates } = await import("./templatesClient.ts");
  stubFetch(() => json({ templates: [] }));
  const res = await fetchTemplates();
  assert.deepEqual(res.templates, []);
  assert.equal(res.failed, null, "a workspace with no templates has not failed at anything");
});

test("a 500 answers the TEMPLATE_LIST_FAILED code, never a raw message", async () => {
  const { fetchTemplates } = await import("./templatesClient.ts");
  stubFetch(() => json({ error: "SQLITE_CANTOPEN: unable to open database file", code: "TEMPLATE_LIST_FAILED" }, 500));
  const res = await fetchTemplates();
  assert.deepEqual(res.templates, []);
  assert.equal(res.failed?.code, "TEMPLATE_LIST_FAILED");
  // The server's English (with its sqlite detail) must not be on the result at
  // all — the client resolves `errors.TEMPLATE_LIST_FAILED` instead.
  assert.equal(res.failed?.error, undefined);
});

test("a transport failure reports the same code rather than resolving empty", async () => {
  const { fetchTemplates } = await import("./templatesClient.ts");
  globalThis.fetch = (() => Promise.reject(new Error("network down"))) as FetchLike;
  const res = await fetchTemplates();
  assert.deepEqual(res.templates, []);
  assert.equal(res.failed?.code, "TEMPLATE_LIST_FAILED");
});

test("a malformed 200 body degrades to an empty list, not a throw", async () => {
  const { fetchTemplates } = await import("./templatesClient.ts");
  stubFetch(() => json({}));
  const res = await fetchTemplates();
  assert.deepEqual(res.templates, []);
  assert.equal(res.failed, null, "the endpoint answered; there is simply nothing in it");
});

test("two callers in the same tick share ONE request (sharedGetJson)", async () => {
  const { fetchTemplates } = await import("./templatesClient.ts");
  const seen = stubFetch(() => json({ templates: [{ id: "t1", name: "A", body: "b", isDefault: 0, scope: "company" }] }));
  const [a, b] = await Promise.all([fetchTemplates(), fetchTemplates()]);
  assert.equal(seen.length, 1, "the builder and the provenance line must not both hit /api/templates");
  assert.deepEqual(a.templates, b.templates);
});
