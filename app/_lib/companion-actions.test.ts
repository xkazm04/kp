// THE DERIVATION TEST — the point of the action catalog, asserted.
//
// `companion-actions.ts` exists so that the three things which have to agree
// about an action cannot drift: the PROMPT that teaches the model to emit it, the
// VALIDATOR that decides whether an emitted fence is real, and the EXECUTOR that
// runs it once the operator accepts. They agree today because all three derive
// from one array. This file pins the derivation itself — the moment someone adds
// a second list (a hardcoded id in the Python prompt, an executor switch that
// forgot a case), one of these goes red.
//
// It is deliberately a SET-EQUALITY test rather than a "does the catalog contain
// run_analysis" test. Pinning the members would pass while a fourth action was
// added to the executor and never taught; pinning the derivation catches that,
// and keeps passing when a fifth action is added correctly.
//
// Nothing here touches a database or spawns anything: the catalog's static import
// graph is empty by design (every `execute` reaches its dependencies with a lazy
// `import()`), which is exactly what makes it testable with `node --test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPANION_ACTIONS,
  MAX_ACTIONS_PER_REPLY,
  coerceCompanionAction,
  companionAction,
  companionActionIds,
  companionActionWire,
  digestDayIso,
} from "./companion-actions.ts";
import { coerceProposalPayload } from "./companion-proposal-view.ts";

const ids = () => [...companionActionIds()].sort();

test("the wire catalog carries EXACTLY the catalog's ids - the prompt cannot teach an action that does not exist", () => {
  const wire = companionActionWire()
    .map((entry) => entry.id)
    .sort();
  assert.deepEqual(wire, ids());
  // Non-vacuity: an empty catalog would make every set-equality below trivially
  // true, which is how this family of guard reads green while checking nothing.
  assert.ok(wire.length >= 4, `expected the v1 action set, found ${wire.length}`);
});

test("the wire catalog carries EXACTLY each action's declared params - the prompt cannot teach a param the validator drops", () => {
  for (const spec of COMPANION_ACTIONS) {
    const wire = companionActionWire().find((entry) => entry.id === spec.id);
    assert.ok(wire, `${spec.id} is missing from the wire catalog`);
    assert.deepEqual(
      wire.params.map((p) => `${p.name}:${p.required}`),
      spec.params.map((p) => `${p.name}:${p.required}`),
      `${spec.id}'s shipped params diverged from its declared params`
    );
    // Every param's doc is shipped to the model verbatim, so an empty one teaches
    // nothing and produces a parameter the model has to guess at.
    for (const param of wire.params) assert.ok(param.doc.trim().length > 10, `${spec.id}.${param.name} has no doc`);
    assert.ok(wire.description.trim().length > 20, `${spec.id} has no description to teach`);
  }
});

test("the EXECUTOR map handles exactly the catalog's ids - no id is proposable but unrunnable", () => {
  // `companionAction` IS the executor lookup the resolve route uses. Every id the
  // prompt teaches must resolve to a spec with a real `execute`, and nothing else
  // may resolve at all.
  for (const id of companionActionIds()) {
    const spec = companionAction(id);
    assert.ok(spec, `${id} is taught but the executor cannot find it`);
    assert.equal(typeof spec.execute, "function", `${id} has no executor`);
    assert.equal(typeof spec.summary, "function", `${id} has no summary`);
  }
  assert.equal(companionAction("definitely_not_an_action"), null);
  assert.equal(companionAction(""), null);
});

test("the VALIDATOR accepts exactly the catalog's ids", () => {
  const accepted = companionActionIds().filter((id) => {
    const required = Object.fromEntries(
      (companionAction(id)?.params ?? []).filter((p) => p.required).map((p) => [p.name, "x"])
    );
    return coerceCompanionAction({ id, params: required }).ok;
  });
  assert.deepEqual([...accepted].sort(), ids());
  assert.equal(coerceCompanionAction({ id: "not_a_real_action", params: {} }).ok, false);
});

test("action ids are stable identifiers, not prose - they are stored in a column and matched by Python", () => {
  for (const id of companionActionIds()) {
    assert.match(id, /^[a-z][a-z0-9_]{2,39}$/, `${id} is not a safe stored identifier`);
  }
  assert.equal(new Set(companionActionIds()).size, companionActionIds().length, "duplicate action id");
});

test("a missing required param is a refusal, and an absent optional one is simply absent", () => {
  const withOptional = coerceCompanionAction({ id: "run_analysis", params: { candidate: "A. Novak" } });
  assert.ok(withOptional.ok);
  assert.deepEqual(withOptional.params, { candidate: "A. Novak" });

  const missing = coerceCompanionAction({ id: "run_analysis", params: {} });
  assert.equal(missing.ok, false);
  const blank = coerceCompanionAction({ id: "run_analysis", params: { candidate: "   " } });
  assert.equal(blank.ok, false, "whitespace is not a value");
});

test("an undeclared param is DROPPED, never carried - a param nothing declared is a param nothing can validate", () => {
  const coerced = coerceCompanionAction({
    id: "generate_digest",
    params: { entryId: "smuggled", stage: "Hired" },
  });
  assert.ok(coerced.ok);
  assert.deepEqual(coerced.params, {});
});

test("a non-string param value is refused rather than stringified", () => {
  for (const bad of [42, true, null, { a: 1 }, ["x"]]) {
    const coerced = coerceCompanionAction({ id: "run_analysis", params: { candidate: bad } });
    assert.equal(coerced.ok, false, `expected a refusal for ${JSON.stringify(bad)}`);
  }
});

test("a summary is a catalog REFERENCE, never a sentence - the row outlives the reader who wrote it", () => {
  for (const spec of COMPANION_ACTIONS) {
    const summary = spec.summary({ candidate: "A. Novak", title: "Platform engineer" });
    assert.match(summary.key, /^[a-zA-Z][a-zA-Z0-9]*$/, `${spec.id}'s summary key is not a catalog key`);
    // A key, not English. If this ever contains a space it has become a sentence.
    assert.doesNotMatch(summary.key, /\s/, `${spec.id}'s summary key reads like prose`);
  }
});

test("a stored payload round-trips, and a payload from an older build degrades rather than lying", () => {
  const coerced = coerceCompanionAction({ id: "draft_jd", params: { title: "Platform engineer", need: "we need one" } });
  assert.ok(coerced.ok);
  const stored = JSON.parse(
    JSON.stringify({ actionId: coerced.id, params: coerced.params, summary: coerced.summary })
  );
  const read = coerceProposalPayload(stored);
  assert.ok(read);
  assert.equal(read.actionId, "draft_jd");
  assert.equal(read.params.title, "Platform engineer");
  assert.equal(read.summary.key, "draftJd");

  // A row that predates the summary reference resolves to the "cannot describe"
  // key, so the dock renders an honest line instead of an empty card.
  const legacy = coerceProposalPayload({ actionId: "draft_jd" });
  assert.equal(legacy?.summary.key, "unknown");
  // Nothing at all is null, not a confident empty proposal.
  for (const bad of [null, undefined, "x", 42, [], {}, { params: {} }]) {
    assert.equal(coerceProposalPayload(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("the per-reply cap is a shared number, and the digest's identity is the day", () => {
  assert.equal(MAX_ACTIONS_PER_REPLY, 2);
  assert.equal(digestDayIso(new Date("2026-08-24T23:59:59.000Z")), "2026-08-24");
  assert.equal(digestDayIso(new Date("2026-08-25T00:00:01.000Z")), "2026-08-25");
});
