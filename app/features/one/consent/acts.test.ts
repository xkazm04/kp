// The act resolver arms only from typed params, and the command text it builds is the
// one the EXISTING parser reads back to the same intent (app/_lib/pipeline-command.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "@/app/_lib/pipeline-command";
import { resolveAct, COMPANION_ACTION_IDS } from "./acts.ts";

test("entry acts carry the CAS stage and say what reaches the candidate", () => {
  const r = resolveAct("entryReject", { entryId: "e1", expectedStage: "Screened", label: "Jana" });
  assert.ok(r.armed && r.act === "entryReject");
  if (r.armed && r.act === "entryReject") {
    assert.equal(r.action, "reject");
    assert.equal(r.expectedStage, "Screened");
    assert.equal(r.emails, "rejection");
    assert.equal(r.reversible, false);
  }
  assert.equal(resolveAct("entryAdvance", { entryId: "e1" }).armed, false, "no stage, no CAS, no act");
});

test("a reject wave round-trips through the real command parser", () => {
  const r = resolveAct("wave", { mode: "reject", threshold: "40", role: "backend" });
  assert.ok(r.armed && r.act === "wave" && r.mode === "reject");
  if (r.armed && r.act === "wave") {
    assert.deepEqual(parseCommand(r.text), { kind: "reject_below", threshold: 40, jobQuery: "backend" });
    assert.equal(r.reversible, true);
  }
});

test("an advance wave round-trips and is final", () => {
  const r = resolveAct("wave", { mode: "advance", count: "3" });
  assert.ok(r.armed && r.act === "wave");
  if (r.armed && r.act === "wave") {
    assert.deepEqual(parseCommand(r.text), { kind: "advance_top", count: 3 });
    assert.equal(r.reversible, false);
  }
});

test("bad numbers and stray fields disarm", () => {
  assert.equal(resolveAct("wave", { mode: "reject", threshold: "0" }).armed, false);
  assert.equal(resolveAct("wave", { mode: "reject", threshold: "101" }).armed, false);
  assert.equal(resolveAct("wave", { mode: "advance", count: "3", role: "x" }).armed, false);
  assert.equal(resolveAct("wave", { mode: "reject", threshold: "40", amount: "9" }).armed, false);
  assert.equal(resolveAct("companion", { action: "hire_everyone" }).armed, false);
});

test("every companion action is downgraded to a Console hand-off with its cost stated", () => {
  for (const action of COMPANION_ACTION_IDS) {
    const r = resolveAct("companion", { action });
    assert.ok(r.armed && r.act === "companion" && r.cost === "modelCall" && typeof r.handoff === "string");
  }
});
