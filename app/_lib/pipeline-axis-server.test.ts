// The DB half of the board-axis resolver: what a workspace with NO stored row
// gets, what an override does to it, and that one team's board never leaks into
// another's. Nothing pinned any of it, and this is the read that decides which
// stage every server-side writer is allowed to put a candidate on.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { getPipelineAxis, stageForRole } from "./pipeline-axis-server.ts";
import { setDecisionConfig } from "./decision-config-store.ts";
import { DEFAULT_STAGE_AXIS } from "./pipeline-stages.ts";

after(() => cleanupUnitDb());

test("a workspace with NO stored row gets the shipped axis, not an empty board", () => {
  const axis = getPipelineAxis("ws-axis-untouched");
  assert.deepEqual(
    axis.stages.map((s) => s.id),
    DEFAULT_STAGE_AXIS.map((s) => s.id)
  );
  assert.deepEqual(axis.retired, []);
  // The default-workspace read (no argument at all) is the same answer.
  assert.deepEqual(
    getPipelineAxis().stages.map((s) => s.id),
    DEFAULT_STAGE_AXIS.map((s) => s.id)
  );
});

test("stageForRole answers the workspace's own column for a unique role, null for one it lacks", () => {
  assert.equal(stageForRole("entry", "ws-axis-untouched"), "Accepted");
  assert.equal(stageForRole("offer", "ws-axis-untouched"), "Offer");
  assert.equal(stageForRole("terminal", "ws-axis-untouched"), "Hired");

  setDecisionConfig(
    "pipelineStages",
    {
      stages: [
        { id: "Inbox", label: "Inbox", role: "entry" },
        { id: "Signed", label: "Signed", role: "terminal" },
      ],
      retired: [{ id: "Offer", label: "Offer", role: "offer" }],
    },
    "ws-axis-renamed"
  );

  assert.equal(stageForRole("entry", "ws-axis-renamed"), "Inbox");
  assert.equal(stageForRole("terminal", "ws-axis-renamed"), "Signed", "the ROLE resolves, the shipped name does not");
  assert.equal(
    stageForRole("offer", "ws-axis-renamed"),
    null,
    "a RETIRED column is not a place to move somebody TO, so the role reads null"
  );
});

test("one workspace's override never reaches another", () => {
  assert.equal(stageForRole("terminal", "ws-axis-renamed"), "Signed");
  assert.equal(stageForRole("terminal", "ws-axis-untouched"), "Hired");
  assert.equal(stageForRole("terminal"), "Hired", "the default workspace is untouched too");
});
