// remaining-add-callers-read-the-code (wave 19b) — the Fit Matrix bulk add threw
// the refusal away entirely: every failed cell became a tally ("0 added, 7 failed")
// with no reason at all, even when the door had answered FORBIDDEN_CAPABILITY and
// named the permission the seat was missing.
//
// Non-vacuity: against pre-fix code every assertion fails — `refusal` did not exist
// in the hook, `lastAdd` had no `reason`, and the announce was the bare tally.
//
// Runner: Node's built-in test runner (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hook = readFileSync(new URL("./useMatrixTab.ts", import.meta.url), "utf8");
const add = hook.slice(hook.indexOf("const addSelected"), hook.indexOf("const exitSelect"));

test("the bulk add keeps the first refusal's code and capability", () => {
  assert.match(add, /res\.code/, "the hook must read the machine refusal");
  assert.match(add, /capability: res\.capability \?\? null/, "…and the permission it named");
  assert.doesNotMatch(add, /res\.message/, "the server's English must never be read");
});

test("the refusal is folded to a localized sentence and reaches both outputs", () => {
  assert.match(add, /capabilityAwareReason\(errMsg, refusal, ""\)/, "resolved through the shared fold");
  assert.match(add, /addReason \? ` \$\{addReason\}` : ""/, "the live region carries the reason after the tally");
  assert.match(add, /reason: addReason \|\| null/, "…and the visible band gets it too");
});

test("lastAdd carries the reason so the band can stop being a bare count", () => {
  assert.match(hook, /useState<\{ ok: number; failed: number; reason: string \| null \}/, "lastAdd must carry the reason");
});
