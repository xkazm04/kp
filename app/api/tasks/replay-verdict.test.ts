// challenge-r05 workspace-config-api/B — the list and the retry door read ONE verdict.
//
// GET /api/tasks and GET /api/tasks/history stamp `replay` on each dead row from the
// stored params (the polled payload itself still carries params:null), and
// POST /api/tasks/[id]/retry refuses the same row for the same reason. Both come from
// app/_lib/task-replay.ts, so the row and the refusal cannot disagree.
//
// Open mode (no KP_OPERATOR_PASSWORD) folds the caller to owner, so the seat is held.
// unit-db.ts must stay the FIRST project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { ensureDb } from "../../_lib/db/core.ts";
import { createTask, finishTask, markTaskRunning } from "../../_lib/db/tasks.ts";
import { DEFAULT_WORKSPACE_ID } from "../../_lib/db/workspaces.ts";
import { GET as listGET } from "./route.ts";
import { GET as historyGET } from "./history/route.ts";
import { POST as retryPOST } from "./[id]/retry/route.ts";

after(() => cleanupUnitDb());

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(path.join(HERE, ...p), "utf8");

const nowhere = `/nonexistent-kp-replay-${Date.now()}`;
const GONE = { baseDir: nowhere, variants: [{ label: "x", cvPath: `${nowhere}/cv.pdf` }] };

function deadRow(id: string, kind: string, params: Record<string, unknown>, status: "failed" | "canceled" = "failed") {
  assert.ok(createTask(id, kind, null, id, params, DEFAULT_WORKSPACE_ID));
  markTaskRunning(id);
  assert.ok(finishTask(id, status, { error: "boom" }));
}

type Row = { id: string; params: unknown; replay?: unknown };

test("GET /api/tasks stamps the verdict on dead rows and keeps params off the wire", async () => {
  deadRow("rv-analyze", "analyze", GONE);
  deadRow("rv-screen", "batch_screen", { entryIds: ["e1"] });
  const r = await listGET();
  assert.equal(r.status, 200);
  const { tasks } = (await r.json()) as { tasks: Row[] };
  const byId = new Map(tasks.map((t) => [t.id, t]));
  assert.deepEqual(byId.get("rv-analyze")?.replay, { replayable: false, reason: "inputs-gone" });
  assert.deepEqual(byId.get("rv-screen")?.replay, { replayable: true });
  for (const t of tasks) assert.equal(t.params, null, "the polled list must not carry params");
});

test("POST retry on the SAME row answers 409 TASK_REPLAY_INPUTS_GONE", async () => {
  const req = new NextRequest("http://localhost/api/tasks/rv-analyze/retry", {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.9" },
  });
  const r = await retryPOST(req, { params: Promise.resolve({ id: "rv-analyze" }) });
  assert.equal(r.status, 409);
  assert.equal(((await r.json()) as { code?: string }).code, "TASK_REPLAY_INPUTS_GONE");
});

test("GET /api/tasks/history stamps the same verdict on an older dead row", async () => {
  deadRow("rv-old", "analyze", GONE, "canceled");
  ensureDb().prepare(`UPDATE tasks SET finished_at = ? WHERE id = ?`).run("2020-01-01T00:00:00.000Z", "rv-old");
  const r = await historyGET(new Request("http://localhost/api/tasks/history"));
  assert.equal(r.status, 200);
  const { tasks } = (await r.json()) as { tasks: Row[] };
  const row = tasks.find((t) => t.id === "rv-old");
  assert.ok(row, "the old row pages into history");
  assert.deepEqual(row.replay, { replayable: false, reason: "inputs-gone" });
  assert.equal(row.params, null);
});

test("both list routes and the retry door derive from task-replay.ts; the private check is gone", () => {
  for (const file of [["route.ts"], ["history", "route.ts"]]) {
    const src = read(...file);
    assert.match(src, /attachReplayVerdicts\(/, `${file.join("/")}: must stamp the verdict`);
    assert.match(src, /listTaskParams/, `${file.join("/")}: one bounded params read`);
    assert.doesNotMatch(src, /getTask\(/, `${file.join("/")}: never one getTask per row per poll`);
  }
  const retry = read("[id]", "retry", "route.ts");
  assert.match(retry, /replayBlock\(task\.kind, params, existsSync\)/);
  assert.doesNotMatch(retry, /function replayInputsMissing/, "the retry route must not keep its own copy");
});
