// bug-ui-scan-2026-07-09 (guided-pipeline-simulation #3): pin the two-step confirm.
// Non-vacuity: the pre-fix control room had NO gate — a single click executed the
// consequential action immediately. The "first click must NOT execute" assertion is
// exactly what a pre-fix (execute-on-first-click) implementation fails; it can't pass
// vacuously because it also asserts the control becomes armed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { armOrExecute, ARMED_TTL_MS, cancelArmed, floorKey, gateKey } from "./controlRoomConfirm.ts";

const roomSrc = readFileSync(fileURLToPath(new URL("./ControlRoom.tsx", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const barSrc = readFileSync(fileURLToPath(new URL("./AutonomyBar.tsx", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

test("pause and resume stay single-click: AutonomyBar must not route them through guard", () => {
  assert.match(barSrc, /onClick=\{\(\) => void onAct\("resume"\)\}/);
  assert.match(barSrc, /onClick=\{\(\) => void onAct\("pause"\)\}/);
  assert.match(barSrc, /guard\("reconcile", \(\) => onAct\("reconcile"\)\)/);
  assert.doesNotMatch(barSrc, /guard\(\s*["']pause["']/);
  assert.doesNotMatch(barSrc, /guard\(\s*["']resume["']/);
});

test("a first click ARMS the control and does not execute (the misclick guard)", () => {
  const r = armOrExecute(null, "gate-42");
  assert.equal(r.execute, false, "one click must never fire a consequential action");
  assert.equal(r.nextArmed, "gate-42", "the control is now armed, awaiting confirm");
});

test("a second click on the SAME armed control executes and disarms", () => {
  const r = armOrExecute("gate-42", "gate-42");
  assert.equal(r.execute, true);
  assert.equal(r.nextArmed, null, "disarms after firing so it can't double-fire");
});

test("clicking a DIFFERENT control re-arms the new one without executing either", () => {
  const r = armOrExecute(floorKey(70), "reconcile");
  assert.equal(r.execute, false, "switching targets never executes the old or new action");
  assert.equal(r.nextArmed, "reconcile");
});

// The promote floor is applied by VALUE, and the room re-polls the calibration every
// 3s — so `suggestedFloor` can move between the arm click and the confirm click (one
// newly-decided outcome flips which band first crosses the majority-hire threshold).
// Non-vacuity: with the pre-fix constant key (`floorKey` returning "floor" for every
// value) `armed === clicked` still holds here, so `execute` comes back true and this
// test fails — which is exactly the defect: confirming "→ 70" fired setFloor(55).
test("a promote floor that CHANGED under the arm re-arms instead of firing", () => {
  const r = armOrExecute(floorKey(70), floorKey(55));
  assert.equal(r.execute, false, "a confirm must never apply a floor the operator didn't confirm");
  assert.equal(r.nextArmed, floorKey(55), "the new suggestion is armed, awaiting its own confirm");
});

test("confirming the SAME suggested floor still applies it", () => {
  const r = armOrExecute(floorKey(70), floorKey(70));
  assert.equal(r.execute, true);
  assert.equal(r.nextArmed, null);
});

test("a gate whose detail changed under the arm re-arms instead of firing", () => {
  const r = armOrExecute(gateKey("lc-1", "v1"), gateKey("lc-1", "v2"));
  assert.equal(r.execute, false, "a confirm must never sign off a descriptor the operator did not see");
  assert.equal(r.nextArmed, gateKey("lc-1", "v2"));
});

test("confirming the SAME gate descriptor still applies it", () => {
  const r = armOrExecute(gateKey("lc-1", "v1"), gateKey("lc-1", "v1"));
  assert.equal(r.execute, true);
  assert.equal(r.nextArmed, null);
});

test("a confirm older than the TTL disarms without executing", () => {
  const r = armOrExecute("gate-42", "gate-42", ARMED_TTL_MS + 1, 0);
  assert.equal(r.execute, false, "a parked Confirm must not fire after the operator has left");
  assert.equal(r.nextArmed, null);
});

test("a confirm just inside the TTL still executes", () => {
  const r = armOrExecute("gate-42", "gate-42", ARMED_TTL_MS - 1, 0);
  assert.equal(r.execute, true);
  assert.equal(r.nextArmed, null);
});

test("cancelArmed disarms without executing", () => {
  const r = cancelArmed();
  assert.equal(r.execute, false);
  assert.equal(r.nextArmed, null);
});

test("ControlRoom Escape while armed calls cancelArmed and does not execute", () => {
  assert.match(roomSrc, /cancelArmed\(\)/);
  assert.match(roomSrc, /e\.key !== "Escape"/);
  assert.match(roomSrc, /window\.addEventListener\("keydown", onKey\)/);
  assert.match(roomSrc, /aria-live="polite"/);
  assert.match(roomSrc, /t\("disarmed"\)/);
});

test("ControlRoom stores armedAt and passes Date.now() into the reducer", () => {
  assert.match(roomSrc, /const \[armedAt, setArmedAt\] = useState<number \| null>\(null\)/);
  assert.match(roomSrc, /armOrExecute\(armed, key, Date\.now\(\), armedAt\)/);
  assert.match(roomSrc, /setArmedAt\(nextArmed \? Date\.now\(\) : null\)/);
});
