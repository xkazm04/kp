import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

const { NextRequest } = await import("next/server");
const create = await import("./route.ts");
const edit = await import("./[id]/route.ts");

after(() => cleanupUnitDb());

test("template create and edit code unsupported placeholders with rejected names", async () => {
  const previous = process.env.KP_OPERATOR_PASSWORD;
  delete process.env.KP_OPERATOR_PASSWORD;
  try {
    const request = (method: string, body: object) => new NextRequest("http://localhost/api/templates", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const invalidCreate = await create.POST(request("POST", { name: "Test", body: "{{tilte}}" }));
    assert.equal(invalidCreate.status, 400);
    const createBody = await invalidCreate.json();
    assert.equal(createBody.code, "TEMPLATE_UNKNOWN_PLACEHOLDERS");
    assert.deepEqual(createBody.tokens, ["tilte"]);
    const validCreate = await create.POST(request("POST", { name: "Test", body: "{{title}}" }));
    assert.equal(validCreate.status, 200);
    const id = (await validCreate.json()).template.id as string;
    const invalidEdit = await edit.PUT(request("PUT", { body: "{{tilte}}" }), { params: Promise.resolve({ id }) });
    assert.equal(invalidEdit.status, 400);
    assert.equal((await invalidEdit.json()).code, "TEMPLATE_UNKNOWN_PLACEHOLDERS");
  } finally {
    if (previous === undefined) delete process.env.KP_OPERATOR_PASSWORD;
    else process.env.KP_OPERATOR_PASSWORD = previous;
  }
});
