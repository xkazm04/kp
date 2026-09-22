import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

const { POST } = await import("./route.ts");

after(() => cleanupUnitDb());

test("user and operator credential failures share a coded 401", async () => {
  const previous = process.env.KP_OPERATOR_PASSWORD;
  process.env.KP_OPERATOR_PASSWORD = "test-operator-secret";
  try {
    const request = (body: object) => new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const user = await POST(request({ email: "missing@example.invalid", password: "bad" }));
    const operator = await POST(request({ password: "bad" }));
    assert.equal(user.status, 401);
    assert.equal(operator.status, 401);
    const userBody = await user.json();
    assert.deepEqual(userBody, await operator.json());
    assert.equal(userBody.code, "LOGIN_CREDENTIALS_INVALID");
  } finally {
    if (previous === undefined) delete process.env.KP_OPERATOR_PASSWORD;
    else process.env.KP_OPERATOR_PASSWORD = previous;
  }
});
