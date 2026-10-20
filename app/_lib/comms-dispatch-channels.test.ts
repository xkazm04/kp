// The two channel literals are declared TWICE on purpose: in the import-free
// comms-resend-outcome.ts (the client-side resend door reads them) and locally in
// comms-dispatch.ts (the server writes them). comms-dispatch used to import and
// re-export them, which put one more module on every route graph that reaches the
// dispatcher (perf-budget.json) for two string literals. A copy is only safe while
// the copies agree, so this file pins that — and pins that the import did not come back.
//
// unit-db.ts MUST be the first project import (comms-dispatch reaches the db modules).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import * as dispatch from "./comms-dispatch.ts";
import * as door from "./comms-resend-outcome.ts";

after(() => cleanupUnitDb());

const dispatchSrc = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "comms-dispatch.ts"), "utf8");

test("the dispatcher writes the same channel literals the resend door reads", () => {
  assert.equal(dispatch.SIM_COMMS_CHANNEL, door.SIM_COMMS_CHANNEL);
  assert.equal(dispatch.REFUSED_COMMS_CHANNEL, door.REFUSED_COMMS_CHANNEL);
});

test("comms-dispatch keeps its own copies instead of importing the resend-door module", () => {
  assert.doesNotMatch(dispatchSrc, /from\s+["']\.\/comms-resend-outcome(\.ts)?["']/);
  assert.match(dispatchSrc, /export const SIM_COMMS_CHANNEL = "simulation";/);
  assert.match(dispatchSrc, /export const REFUSED_COMMS_CHANNEL = "refused";/);
});
