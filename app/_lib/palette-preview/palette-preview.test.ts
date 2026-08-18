// The command palette's preview contract, pinned:
//   A. every PREVIEWABLE_TABS entry resolves — on a fresh, self-seeded workspace
//      DB — to the union member NAMED AFTER IT (a resolver wired to the wrong case,
//      or a throwing read, fails here rather than as a blank pane in the app);
//   B. the operator gate: the operator-only tabs answer { view: "restricted" } for
//      a non-operator caller and their real view for an operator, and no other tab
//      is ever restricted;
//   C. an unknown entity id answers { view: "missing" } for every kind (never a throw).
//
// unit-db is the FIRST project import (throwaway KP_DB_PATH, deterministic env).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ENTITY_KINDS, OPERATOR_ONLY_TABS, PREVIEWABLE_TABS, resolveEntityPreview, resolveTabPreview } from "./index.ts";

const WS = "workspace";

after(() => cleanupUnitDb());

test("A. every previewable tab resolves to its own view for an operator", async () => {
  for (const tab of PREVIEWABLE_TABS) {
    const p = await resolveTabPreview(tab, WS, true);
    assert.equal(p.view, tab, `tab ${tab} resolved to view ${p.view}`);
  }
});

test("B. operator-only tabs are restricted for a non-operator, nothing else is", async () => {
  for (const tab of PREVIEWABLE_TABS) {
    const p = await resolveTabPreview(tab, WS, false);
    if (OPERATOR_ONLY_TABS.has(tab)) assert.equal(p.view, "restricted", `tab ${tab} should be restricted`);
    else assert.equal(p.view, tab, `tab ${tab} should not be restricted`);
  }
});

test("C. an unknown entity id is 'missing' for every kind", () => {
  for (const kind of ENTITY_KINDS) {
    assert.equal(resolveEntityPreview(kind, "no-such-id-" + kind, WS).view, "missing");
  }
});

test("pipeline preview carries the axis stages in board order with counts", async () => {
  const p = await resolveTabPreview("pipeline", WS, true);
  assert.equal(p.view, "pipeline");
  if (p.view !== "pipeline") return;
  assert.ok(p.stages.length > 0, "at least one stage");
  for (const s of p.stages) {
    assert.equal(typeof s.id, "string");
    assert.equal(typeof s.label, "string");
    assert.ok(Number.isInteger(s.count) && s.count >= 0);
  }
  assert.equal(
    p.active,
    p.stages.reduce((a, s) => a + s.count, 0),
    "active equals the stage counts summed"
  );
});
