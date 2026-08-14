// The background-task routes are the single door for every AI job the UI starts —
// TasksProvider.startTask posts to /api/tasks, so screen waves, group evaluations,
// interview prep, campaign packs, batch outreach and match reasoning all arrive
// here. Every one of the five route files omitted the workspace, which broke the
// feature in both directions at once:
//
//   READ   the tray and history listed the DEFAULT tenant's rows to every team,
//          and task labels embed candidate names and role titles;
//   WRITE  a non-default team's task was stamped for the default tenant, so its
//          handler looked the entry up in the wrong team and failed "entry not
//          found" — or succeeded against the wrong cohort and billed for it;
//   BY-ID  getTask had no ownership predicate at all, and the id is not a secret:
//          llm_usage.request_id IS the task id and the Activity tab renders that
//          ledger deployment-wide, so any row was readable and cancellable.
//
// Source-level for the route contract (these handlers need a request scope the
// unit runner cannot give them), behavioural for the store predicate underneath.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { createTask, getTask, listRecentTasks, markTasksSeen } from "../../_lib/db/tasks.ts";
import { DEFAULT_WORKSPACE_ID } from "../../_lib/db/workspaces.ts";

after(() => cleanupUnitDb());

const WS_B = "team-tasks-b";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(path.join(HERE, ...p), "utf8");

// ---- store predicate ------------------------------------------------------

test("getTask enforces ownership when given a tenant, and stays open without one", () => {
  const mine = createTask("t-own-b", "analyze", null, "Mine", { a: 1 }, WS_B);
  assert.ok(mine);

  assert.ok(getTask("t-own-b", WS_B), "the owning team reads its own task");
  assert.equal(getTask("t-own-b", DEFAULT_WORKSPACE_ID), null, "another team must not read it");
  // The runner and createTask read by id with no tenant — that path must survive.
  assert.ok(getTask("t-own-b"), "an omitted tenant means system context, not 404");
});

test("the live list and the seen-ack are per team", () => {
  createTask("t-list-a", "analyze", null, "A row", {}, DEFAULT_WORKSPACE_ID);
  const since = new Date(Date.now() - 60_000).toISOString();

  const idsB = listRecentTasks(since, 60, WS_B).map((t) => t.id);
  assert.ok(idsB.includes("t-own-b"), "team B sees its own");
  assert.ok(!idsB.includes("t-list-a"), "team B must not see team A's");

  // An ack from the wrong team stamps nothing — it used to clear their unread flags.
  assert.equal(markTasksSeen(["t-list-a"], WS_B), 0, "cross-tenant ack must be a no-op");
});

// ---- route contract -------------------------------------------------------

test("every task route resolves the session workspace and threads it", () => {
  const cases: [string, RegExp[]][] = [
    ["route.ts", [/listRecentTasks\(recentTaskCutoffIso\(\), undefined, ws\)/, /startTask\(body\.kind, body\.params \?\? \{\}, await currentWorkspace\(\)\)/]],
    ["history/route.ts", [/countTaskHistory\(before, filter, ws\)/, /listTaskHistory\(before, limit, offset, filter, ws\)/]],
    ["seen/route.ts", [/markTasksSeen\(ids, await currentWorkspace\(\)\)/]],
    ["[id]/route.ts", [/getTask\(id, await currentWorkspace\(\)\)/, /if \(!getTask\(id, ws\)\)/]],
    ["[id]/retry/route.ts", [/getTask\(id, ws\)/, /startTask\(task\.kind, .*, ws\)/]],
  ];
  for (const [file, patterns] of cases) {
    const src = read(...file.split("/"));
    assert.match(src, /currentWorkspace/, `${file}: must resolve a tenant`);
    for (const p of patterns) assert.match(src, p, `${file}: expected ${p}`);
  }
});

test("DELETE proves ownership before aborting, not after", () => {
  // cancelTask works off the id alone (one process-wide abort registry), so the
  // tenant check has to happen in the route or it does not happen at all — and it
  // has to come BEFORE the abort, or the cancel lands and only the reply 404s.
  const src = read("[id]", "route.ts");
  const guard = src.indexOf("if (!getTask(id, ws))");
  const cancel = src.indexOf("cancelTask(id)");
  assert.ok(guard > 0 && cancel > 0, "both the guard and the cancel must be present");
  assert.ok(guard < cancel, "the ownership check must precede cancelTask");
});
