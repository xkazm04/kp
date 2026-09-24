// The provenance vocabulary. Every assertion here is an honesty rule from the
// brief, not a styling preference.
import { test } from "node:test";
import assert from "node:assert/strict";
import { actorKind, isObservedRow, rowFrameClass, rowProvenance, rowTextClass } from "./journeyMarks.ts";

test("actor: null is a FACT, and an unrecognised actor is read the same way", () => {
  assert.equal(actorKind(null), "unidentified");
  assert.equal(actorKind(undefined), "unidentified");
  assert.equal(actorKind("human:recruiter"), "human");
  assert.equal(actorKind("auto:analyze"), "machine");
  // A legacy value with no prefix is not a human. Reading it as one would be
  // the board asserting something the ledger never said.
  assert.equal(actorKind("recruiter"), "unidentified");
  assert.equal(actorKind(""), "unidentified");
});

test("observed means real AND certainly this candidate's", () => {
  const live = { kind: "live" } as const;
  const testRun = { kind: "test-run", runId: "uat-1" } as const;
  assert.equal(isObservedRow({}, live), true);
  assert.equal(isObservedRow({}, undefined), true, "a shared row has no column, and that is not a doubt");
  assert.equal(isObservedRow({ confidence: "label-only" }, live), false);
  assert.equal(isObservedRow({}, testRun), false);
  assert.equal(isObservedRow({ confidence: "label-only" }, testRun), false);
});

test("the four honesty axes are independent, and each one changes the mark", () => {
  const live = { kind: "live" } as const;
  const plain = rowProvenance({ actor: "human:recruiter" }, live);
  const nameOnly = rowProvenance({ actor: "human:recruiter", confidence: "label-only" }, live);
  const unknown = rowProvenance({ actor: null }, live);
  const generated = rowProvenance({ actor: "auto:comms" }, { kind: "test-run", runId: "x" });

  // Upright + solid for the real thing; italic + dotted for the generated one.
  assert.equal(rowTextClass(plain).includes("italic"), false);
  assert.equal(rowFrameClass(plain).includes("border-solid"), true);
  assert.equal(rowTextClass(generated).includes("italic"), true);
  assert.equal(rowFrameClass(generated).includes("border-dotted"), true);

  // Name-only carries the wavy underline whether or not anything else applies.
  assert.equal(rowTextClass(nameOnly).includes("decoration-wavy"), true);
  assert.equal(rowTextClass(plain).includes("decoration-wavy"), false);

  // An unidentified actor is its own frame colour, not a missing one.
  assert.equal(rowFrameClass(unknown).includes("border-l-dial-stone"), true);
  assert.notEqual(rowFrameClass(unknown), rowFrameClass(plain));
  assert.equal(unknown.fromTestRun, false);
  assert.equal(generated.fromTestRun, true);
});

test("no class string carries a literal colour — every mark resolves through a token", () => {
  const strings = [
    rowTextClass(rowProvenance({ actor: null, confidence: "label-only" }, { kind: "test-run", runId: "x" })),
    rowFrameClass(rowProvenance({ actor: "auto:x" }, { kind: "live" })),
  ];
  for (const value of strings) {
    assert.equal(/#[0-9a-fA-F]{6}/.test(value), false, value);
    assert.equal(/rgba?\(/.test(value), false, value);
  }
});
