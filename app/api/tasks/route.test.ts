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

test("a server-only kind (analyze) cannot be started through the generic door", async () => {
  // analyze's params are server-built file paths (/api/analyze persists the uploads
  // into a fresh workdir). Accepting them from a client body let a caller point
  // runAnalyze at any file to read and any directory to rm -rf.
  // The path is deliberately one that does not exist: this case must be harmless even
  // against the vulnerable code it pins the fix for.
  const nowhere = `/nonexistent-kp-test-${Date.now()}`;
  const r = await POST(post({ kind: "analyze", params: { baseDir: nowhere, variants: [{ label: "x", cvPath: `${nowhere}/cv.pdf` }] } }));
  assert.equal(r.status, 403);
  const body = (await r.json()) as { code?: string; kind?: unknown };
  assert.equal(body.code, "TASK_KIND_SERVER_ONLY");
  assert.equal(body.kind, "analyze");
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

// ---- challenge-r05 workspace-config-api/A: the door table ------------------------
//
// The one-kind SERVER_ONLY_KINDS set generalised into app/_lib/task-admission.ts: every
// kind a server route builds and gates itself answers the SAME refusal the analyze fix
// introduced, and none of them leaves a row behind.
const SERVER_KINDS = [
  "analyze",
  "interview_letter",
  "lifecycle",
  "agent_fit",
  "interview_kit",
  "jd_build",
  "repo_scan",
  "companion_digest",
  "jobseeker_scan",
] as const;

for (const kind of SERVER_KINDS) {
  test(`server-built kind ${kind} is refused 403 TASK_KIND_SERVER_ONLY and creates no row`, async () => {
    const { listRecentTasks } = await import("../../_lib/db/tasks.ts");
    const before = listRecentTasks("1970-01-01T00:00:00.000Z", 500).length;
    const r = await POST(post({ kind, params: { lifecycleId: "x", jobId: "x", letterId: "x" } }));
    assert.equal(r.status, 403, `${kind} was admitted through the dock door`);
    const body = (await r.json()) as { code?: string; kind?: unknown };
    assert.equal(body.code, "TASK_KIND_SERVER_ONLY");
    assert.equal(body.kind, kind);
    assert.equal(listRecentTasks("1970-01-01T00:00:00.000Z", 500).length, before, "a refused start must not enqueue");
  });
}

test("the door refusal sits after the overall IP bucket and before the per-class budget", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  const ipAt = src.indexOf("rateLimit(`tasks-start:${ip}`");
  const doorAt = src.indexOf('jsonRefusal("TASK_KIND_SERVER_ONLY", 403');
  const seatAt = src.search(/requireCapabilityCoded\(taskKindCapability\(body\.kind\)/);
  const clsAt = src.indexOf("rateLimit(`tasks-start:${cls}:${ip}`");
  assert.ok(ipAt > 0 && doorAt > ipAt, "the door decision follows the overall bucket");
  assert.ok(seatAt > doorAt, "the seat is asked after the door");
  assert.ok(clsAt > seatAt, "…and a refused start spends no per-class budget");
  assert.match(src, /dockMayStart\(body\.kind\)/, "the door reads the declared table");
  assert.doesNotMatch(src, /SERVER_ONLY_KINDS/, "the one-kind set is absorbed into the table");
});
