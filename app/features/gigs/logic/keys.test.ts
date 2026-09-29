// Pure logic for the desk's keyboard guards (keys.ts): a field swallows shortcuts, digits
// tick the arena's checklist.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { checklistKeyFor, isTypingTarget } from "./keys.ts";

test("isTypingTarget: fields swallow shortcuts, checkboxes do not", () => {
  assert.equal(isTypingTarget({ tagName: "TEXTAREA" } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "text" } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: "INPUT", type: "checkbox" } as unknown as EventTarget), false);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: "BUTTON" } as unknown as EventTarget), false);
  assert.equal(isTypingTarget(null), false);
});

test("checklistKeyFor maps 1-9 onto the arena's items", () => {
  assert.equal(checklistKeyFor("1", ["a", "b"]), "a");
  assert.equal(checklistKeyFor("2", ["a", "b"]), "b");
  assert.equal(checklistKeyFor("3", ["a", "b"]), null);
  assert.equal(checklistKeyFor("j", ["a", "b"]), null);
});
