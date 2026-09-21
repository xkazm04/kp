// POST /api/jds and POST /api/jds/save must send validateJdFields.code, not a
// bare English 400. unit-db.ts must stay the first project import.
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

after(() => cleanupUnitDb());

test("both write doors jsonRefusal the validator's code", () => {
  for (const rel of ["./route.ts", "./save/route.ts"]) {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    assert.match(src, /jsonRefusal\(fields\.code, 400\)/, `${rel} must send fields.code`);
    assert.doesNotMatch(src, /error:\s*fields\.error/, `${rel} must not drop the code`);
  }
});

test("POST /api/jds with an empty title returns JD_FIELDS_REQUIRED", async () => {
  const { POST } = await import("./route.ts");
  const res = await POST(
    new Request("http://localhost/api/jds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "  ", body: "A real body for the write." }),
    }),
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, "JD_FIELDS_REQUIRED");
});
