// The command palette's preview pane opens on a KEYSTROKE, and two of its
// resolvers were reading unboundedly:
//
//   resolveAgents      listHiredAgents(ws) then getAgentAggregates(a.id, ws) PER
//                      AGENT — a classic N+1, growing one activity query per hire.
//   resolveProfile     listPipeline(ws).filter(...).slice(0, 3) — the WHOLE board
//                      hydrated through rowToEntry (github JSON, notes, source
//                      attribution, per entry) to keep at most three rows.
//
// Neither cost is visible in a unit assertion about the RESULT, which is why both
// survived: the numbers were always right. So this file measures the READS. It
// counts prepared statements by wrapping better-sqlite3's own `prepare`, and pins
// the property that matters — the cost must not grow with the corpus.
//
// unit-db is the FIRST project import (throwaway KP_DB_PATH, deterministic env).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { createHiredAgent, getAgentAggregates, getWorkspaceAgentTotals, listHiredAgents, recordAgentExecution } from "../db/agents.ts";
import { createPipelineEntry, listCandidatePlacements } from "../db/pipeline.ts";
import { resolveAgents } from "./resolve-hiring.ts";

const WS = "workspace";

after(() => cleanupUnitDb());

/** Run `fn` and report how many statements were prepared while it ran. Counting
 *  PREPARES (not rows) is what separates "one query over N rows" from "N queries":
 *  better-sqlite3 caches nothing for us here, so a per-item read is a per-item
 *  prepare. The wrapper is installed and removed inside this helper so nothing else
 *  in the suite sees a patched driver. */
function countPrepares<T>(fn: () => T): { result: T; prepares: number } {
  const proto = Database.prototype as unknown as { prepare: (this: unknown, sql: string) => unknown };
  const original = proto.prepare;
  let prepares = 0;
  proto.prepare = function patched(this: unknown, sql: string) {
    prepares++;
    return original.call(this, sql);
  };
  try {
    return { result: fn(), prepares };
  } finally {
    proto.prepare = original;
  }
}

function hireAgentWithRuns(title: string, runs: number): string {
  const agent = createHiredAgent({ jobId: `job-${title}`, jobTitle: title, spec: {} }, WS);
  for (let i = 0; i < runs; i++) {
    recordAgentExecution(agent.id, { execId: `${agent.id}-x${i}`, costUsd: 0.5, status: "success" }, WS);
  }
  return agent.id;
}

test("resolveAgents costs the SAME number of queries at 2 agents and at 8", () => {
  for (let i = 0; i < 2; i++) hireAgentWithRuns(`small-${i}`, 2);
  const small = countPrepares(() => resolveAgents(WS));

  for (let i = 0; i < 6; i++) hireAgentWithRuns(`big-${i}`, 2);
  assert.equal(listHiredAgents(WS).length, 8, "the second wave really was hired");
  const big = countPrepares(() => resolveAgents(WS));

  // THE contract. Pre-fix this grew by one prepare per additional agent (2 → 8 was
  // +6); a constant is what "bounded" means here.
  assert.equal(
    big.prepares,
    small.prepares,
    `the agents preview must not grow a query per agent (2 agents: ${small.prepares}, 8 agents: ${big.prepares})`
  );
  assert.ok(big.prepares <= 4, `and it should be a small constant, not ${big.prepares}`);
});

test("the workspace roll-up equals the per-agent sum it replaced", () => {
  // Same numbers, fewer reads — otherwise this is an optimization that changed the
  // answer, which is the only way it could be worse than the N+1 it replaces.
  const perAgent = listHiredAgents(WS).map((a) => getAgentAggregates(a.id, WS));
  const expectedRuns = perAgent.reduce((n, a) => n + a.runs, 0);
  const expectedSuccesses = perAgent.reduce((n, a) => n + a.successes, 0);
  const expectedMonth = Math.round(perAgent.reduce((n, a) => n + a.monthCostUsd, 0) * 100) / 100;

  const totals = getWorkspaceAgentTotals(WS);
  assert.equal(totals.agents, perAgent.length);
  assert.equal(totals.runs, expectedRuns);
  assert.equal(totals.successes, expectedSuccesses);
  assert.equal(totals.monthCostUsd, expectedMonth);
  assert.equal(totals.successRate, expectedRuns > 0 ? expectedSuccesses / expectedRuns : null);

  const preview = resolveAgents(WS);
  assert.equal(preview.view, "agents");
  if (preview.view === "agents") {
    assert.equal(preview.agents, totals.agents);
    assert.equal(preview.runs, totals.runs);
    assert.equal(preview.successRate, totals.successRate);
  }
});

test("a workspace with agents but no activity reports null, never a 0% success rate", () => {
  const empty = getWorkspaceAgentTotals("workspace-with-nothing");
  assert.equal(empty.agents, 0);
  assert.equal(empty.runs, 0);
  assert.equal(empty.successRate, null, "0 would read as 'every run failed'");
});

test("listCandidatePlacements is LIMITed in SQL, not sliced by the caller", () => {
  const mine = "cand-bounded";
  for (let i = 0; i < 5; i++) {
    createPipelineEntry({
      candidateId: mine,
      candidateLabel: "Bounded Candidate",
      jobId: `role-${i}`,
      jobTitle: `Role ${i}`,
      matchScore: 90 - i,
      workspaceId: WS,
    });
  }
  // …and a much larger board around them, which the old read hydrated in full.
  for (let i = 0; i < 40; i++) {
    createPipelineEntry({
      candidateId: `other-${i}`,
      candidateLabel: `Other ${i}`,
      jobId: `role-${i % 5}`,
      jobTitle: `Role ${i % 5}`,
      matchScore: 50,
      workspaceId: WS,
    });
  }

  const three = listCandidatePlacements(mine, WS, 3);
  assert.equal(three.length, 3);
  assert.deepEqual(
    three.map((p) => p.jobTitle),
    ["Role 0", "Role 1", "Role 2"],
    "highest match first — the same order the board itself uses"
  );
  // Only this candidate's rows, and a hostile limit cannot ask for the whole table.
  assert.ok(listCandidatePlacements(mine, WS, 1000).length <= 5);
  assert.equal(listCandidatePlacements("nobody-at-all", WS).length, 0);
  // Another workspace never sees them.
  assert.equal(listCandidatePlacements(mine, "some-other-workspace").length, 0);
});

test("the profile preview no longer pulls the whole board", () => {
  // A source guard, deliberately: the resolver's placement read only runs for a
  // profile that EXISTS, so a behavioral assertion here would need the whole profile
  // fixture just to pin one line. What must not come back is the unbounded call.
  // (Line endings normalized: this checkout is CRLF, a fresh worktree LF.)
  const text = readFileSync(new URL("./resolve-entities.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(!/\blistPipeline\(/.test(text), "the resolver must not hydrate the whole board any more");
  assert.ok(text.includes("listCandidatePlacements(id, ws, 3)"), "it asks SQLite for three rows instead");
});
