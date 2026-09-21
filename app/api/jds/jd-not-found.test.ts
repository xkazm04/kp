// A missing JD slug must answer JD_NOT_FOUND, not a bare English 404.
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

after(() => cleanupUnitDb());

test("GET /api/jds/[slug] for an unknown slug is jsonRefusal JD_NOT_FOUND", async () => {
  const { GET } = await import("./[slug]/route.ts");
  const res = await GET(new Request("http://localhost/api/jds/no-such-jd"), {
    params: Promise.resolve({ slug: "no-such-jd" }),
  });
  assert.equal(res.status, 404);
  const body = (await res.json()) as { code?: string; error?: string };
  assert.equal(body.code, "JD_NOT_FOUND");
  assert.equal(body.error, "That job description could not be found.");
});
