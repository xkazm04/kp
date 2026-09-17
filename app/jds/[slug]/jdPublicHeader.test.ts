// Pins the public JD header: Analyze CV and job-board Publish are operator
// tools, never part of the candidate share-link chrome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publicJdHeaderActions } from "./jdPublicHeader.ts";

test("an anonymous header has no Analyze CV or Publish controls", () => {
  const actions = publicJdHeaderActions({ canManage: false, applyOpen: true });
  assert.equal(actions.includes("analyzeCv"), false);
  assert.equal(actions.includes("publish"), false);
  assert.deepEqual(actions, ["apply"]);
});

test("a closed anonymous header still has no operator tools", () => {
  const actions = publicJdHeaderActions({ canManage: false, applyOpen: false });
  assert.equal(actions.includes("analyzeCv"), false);
  assert.equal(actions.includes("publish"), false);
  assert.deepEqual(actions, ["notAccepting"]);
});

test("an operator header still has Analyze CV and Publish beside Apply", () => {
  const actions = publicJdHeaderActions({ canManage: true, applyOpen: true });
  assert.ok(actions.includes("analyzeCv"));
  assert.ok(actions.includes("publish"));
  assert.ok(actions.includes("apply"));
});

test("the public page renders the header from publicJdHeaderActions, not a parallel branch", () => {
  const src = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("publicJdHeaderActions("), "the page must call the helper");
  assert.ok(src.includes("headerActions.map"), "the header must iterate the helper's list");
});
