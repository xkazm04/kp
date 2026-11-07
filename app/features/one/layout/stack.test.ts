// The sheet stack rules of the /one layout (stack.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { presets } from "../motion.ts";
import { forAnswer, isWide, MAX_STACK, onClear, onPick, pop, popTo, push, sheetEnter } from "./stack.ts";

test("a row press on an empty stack opens the profile", () => {
  assert.deepEqual(onPick([], "side"), ["profile"]);
  assert.deepEqual(onPick([], null), ["profile"]);
});

test("a press on another row swaps the person — the stack stays", () => {
  assert.deepEqual(onPick(["profile"], "side"), ["profile"]);
  assert.deepEqual(onPick(["profile", "letter"], "side"), ["profile", "letter"]);
  assert.deepEqual(onPick(["letters", "letter"], "letters"), ["letters", "letter"]);
});

test("a pick in the letters sheet pushes the letter; a side pick over it pushes the profile", () => {
  assert.deepEqual(onPick(["letters"], "letters"), ["letters", "letter"]);
  assert.deepEqual(onPick(["letters", "profile"], "letters"), ["letters", "letter"]);
  assert.deepEqual(onPick(["letters"], "side"), ["letters", "profile"]);
  assert.deepEqual(onPick(["letters"], null), ["letters", "letter"]);
});

test("a pick in the calendar is who to book: the calendar stays", () => {
  assert.deepEqual(onPick(["calendar"], "calendar"), ["calendar"]);
  assert.deepEqual(onPick(["calendar"], "side"), ["calendar"]);
});

test("push caps the stack, cuts back to a sheet already below, ignores the top", () => {
  assert.deepEqual(push(["profile"], "profile"), ["profile"]);
  assert.deepEqual(push(["profile", "letter"], "profile"), ["profile"]);
  assert.equal(push(push(push(["letters"], "profile"), "letter"), "schedule").length, MAX_STACK);
  assert.deepEqual(push(["letters", "profile", "letter"], "schedule"), ["profile", "letter", "schedule"]);
});

test("pop removes one; popTo cuts to an index; a clear drops the person sheets only", () => {
  assert.deepEqual(pop(["profile", "letter"]), ["profile"]);
  assert.deepEqual(pop([]), []);
  assert.deepEqual(popTo(["letters", "profile", "letter"], 0), ["letters"]);
  assert.deepEqual(onClear(["letters", "letter"]), ["letters"]);
  assert.deepEqual(onClear(["profile", "schedule"]), []);
});

test("an answer opens the sheet that answers it, any other closes them", () => {
  assert.deepEqual(forAnswer("letters"), ["letters"]);
  assert.deepEqual(forAnswer("calendar"), ["calendar"]);
  assert.deepEqual(forAnswer("profile"), ["profile"]);
  assert.deepEqual(forAnswer("decisionsQueue"), []);
  assert.deepEqual(forAnswer(undefined), []);
});

test("profile and calendar take half the screen", () => {
  assert.equal(isWide(["profile"]), true);
  assert.equal(isWide(["letters", "letter"]), false);
  assert.equal(isWide(["calendar"]), true);
});

test("the sheet slide is the snap preset; reduced motion is the still form", () => {
  const moving = sheetEnter(presets("snap", false));
  assert.ok(moving.initial !== false && typeof moving.initial.x === "number" && moving.initial.x < 0);
  assert.deepEqual(moving.transition, presets("snap", false).answerSwap(-1).transition);
  const still = sheetEnter(presets("snap", true));
  assert.equal(still.initial, false);
  assert.equal(still.transition.duration, 0);
});
