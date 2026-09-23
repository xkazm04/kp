// The single-entry door's declared action table (challenge-r07 pipeline-api/A).
//
// POST /api/pipeline/[id] dispatches eight actions. What each one REQUIRES used to live
// in whichever `if (body.action === …)` branch remembered it, and nothing remembered the
// seat: a viewer could reject, advance, extend an offer or reverse a rejection one card
// at a time. The requirement is now data beside the operation — a literal table the one
// gate reads — so an action with no declared capability is unrepresentable. The same
// table carries the two other per-action facts the route used to get wrong: which action
// may carry an ENGINE claim (body.actor = "sim"), and what a reinstate may reverse.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENTRY_ACTIONS,
  ENTRY_ACTION_NAMES,
  engineClaimOf,
  entryActionOf,
} from "./entry-actions.ts";

test("the table is keyed by exactly the eight actions the door dispatches", () => {
  assert.deepEqual(
    [...ENTRY_ACTION_NAMES].sort(),
    ["accept", "approve_event", "reinstate", "reject", "resolve_intake", "set_github", "set_notes", "set_stage"],
  );
  assert.deepEqual(Object.keys(ENTRY_ACTIONS).sort(), [...ENTRY_ACTION_NAMES].sort());
});

test("every action declares the pipeline:write seat — a viewer can read the board, never move it", () => {
  for (const name of ENTRY_ACTION_NAMES) {
    assert.equal(ENTRY_ACTIONS[name].capability, "pipeline:write", `${name} must declare pipeline:write`);
  }
});

test("entryActionOf admits the table's names and nothing else", () => {
  for (const name of ENTRY_ACTION_NAMES) assert.equal(entryActionOf(name), name);
  for (const raw of ["bogus", "", "ACCEPT", "toString", "__proto__", "constructor", 7, null, undefined, {}]) {
    assert.equal(entryActionOf(raw), null, `${String(raw)} is not an action this door supports`);
  }
});

test("only accept may carry an engine claim — the guided sim's only use", () => {
  const claimers = ENTRY_ACTION_NAMES.filter((n) => ENTRY_ACTIONS[n].engineClaim);
  assert.deepEqual(claimers, ["accept"]);
  assert.equal(engineClaimOf("accept", "sim"), "sim", "the declared engine keeps its attribution on accept");
  for (const name of ENTRY_ACTION_NAMES.filter((n) => n !== "accept")) {
    assert.equal(engineClaimOf(name, "sim"), undefined, `${name} must drop a body-supplied actor`);
  }
});

test("only reinstate declares a reversal, and it reverses an auto-rejection", () => {
  const reversers = ENTRY_ACTION_NAMES.filter((n) => ENTRY_ACTIONS[n].reverses !== null);
  assert.deepEqual(reversers, ["reinstate"]);
  assert.equal(ENTRY_ACTIONS.reinstate.reverses, "auto_rejected");
});
