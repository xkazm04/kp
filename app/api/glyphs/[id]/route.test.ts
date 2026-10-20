// GET /api/glyphs/[id] — the traced empty-state art, served by id.
//
// Pinned by INVOKING the handler: a known id answers the generated TracedGlyph
// unchanged with a private cache header, an unknown id answers 404 with a CODE (never
// a thrown message), and with an operator password set a request with no session is
// refused at the handler too — the proxy gate is not the only door.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "./route.ts";
import { GLYPH_CATALOG } from "@/app/_components/glyph/glyphCatalog";

function get(id: string) {
  return GET(new Request(`http://localhost/api/glyphs/${id}`), { params: Promise.resolve({ id }) });
}

test("a known id answers the generated art unchanged, privately cacheable", async () => {
  delete process.env.KP_OPERATOR_PASSWORD;
  const res = await get("decisions");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), GLYPH_CATALOG.decisions);
  const cache = res.headers.get("cache-control") ?? "";
  assert.match(cache, /\bprivate\b/);
  assert.match(cache, /max-age=\d+/);
});

test("an unknown or prototype-key id answers 404 with the GLYPH_UNKNOWN code", async () => {
  delete process.env.KP_OPERATOR_PASSWORD;
  for (const id of ["nope", "constructor", "__proto__", "jobsGlyph"]) {
    const res = await get(id);
    assert.equal(res.status, 404, id);
    const body = (await res.json()) as { code?: string; error?: string };
    assert.equal(body.code, "GLYPH_UNKNOWN", id);
  }
});

test("with an operator password set, a request with no session is refused at the handler", async () => {
  process.env.KP_OPERATOR_PASSWORD = "test-password";
  try {
    const res = await get("decisions");
    assert.equal(res.status, 401);
  } finally {
    delete process.env.KP_OPERATOR_PASSWORD;
  }
});
