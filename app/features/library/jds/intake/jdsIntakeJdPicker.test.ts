// A 500 on GET /api/jds must not look like an empty library in the attach-JD pane.
import { test } from "node:test";
import assert from "node:assert/strict";
import { intakeJdPickerFromResponse } from "./jdsIntakeJdPicker.ts";

test("a 500 keeps the picker closed and carries JD_LIST_FAILED", () => {
  const failed = intakeJdPickerFromResponse(false, { error: "boom", jds: [] });
  assert.equal(failed.jds, null);
  assert.deepEqual(failed.failed, { code: "JD_LIST_FAILED" });
});

test("a transport-shaped empty body is a failure, not []", () => {
  assert.deepEqual(intakeJdPickerFromResponse(true, { error: "boom", code: "JD_LIST_FAILED" }), {
    jds: null,
    failed: { code: "JD_LIST_FAILED" },
  });
  assert.deepEqual(intakeJdPickerFromResponse(true, null), { jds: null, failed: { code: "JD_LIST_FAILED" } });
});

test("an empty successful list is ready and empty", () => {
  assert.deepEqual(intakeJdPickerFromResponse(true, { jds: [] }), { jds: [], failed: null });
});

test("a successful list maps slug and title", () => {
  const ready = intakeJdPickerFromResponse(true, { jds: [{ slug: "backend", title: "Backend" }] });
  assert.deepEqual(ready, { jds: [{ slug: "backend", title: "Backend" }], failed: null });
});
