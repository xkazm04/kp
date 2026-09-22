// POST /api/tasks — the kind refusal. The client's `startTask` is typed by TaskKind
// now (app/_lib/task-kinds.ts), so a misspelled literal is a compile error at the call
// site; this pins that the RUNTIME door still refuses one too, because the body is
// client JSON and a stale bundle or a hand-written request can carry any string.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";

after(() => cleanupUnitDb());

const post = (body: unknown) =>
  new NextRequest("http://localhost/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify(body),
  });

test("a misspelled kind is refused 400 TASK_KIND_UNKNOWN, naming the kind", async () => {
  const r = await POST(post({ kind: "batch_sceen", params: {} }));
  assert.equal(r.status, 400);
  const body = (await r.json()) as { code?: string; kind?: unknown };
  assert.equal(body.code, "TASK_KIND_UNKNOWN");
  assert.equal(body.kind, "batch_sceen");
});

test("a late-bound runner that is not a queue kind is refused the same way", async () => {
  const r = await POST(post({ kind: "intake_round" }));
  assert.equal(r.status, 400);
  assert.equal(((await r.json()) as { code?: string }).code, "TASK_KIND_UNKNOWN");
});

test("an absent or non-string kind is refused, never coerced", async () => {
  for (const kind of [undefined, 42, "", "constructor"]) {
    const r = await POST(post({ kind }));
    assert.equal(r.status, 400, `kind=${String(kind)}`);
    assert.equal(((await r.json()) as { code?: string }).code, "TASK_KIND_UNKNOWN");
  }
});
