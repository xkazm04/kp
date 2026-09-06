// The control deck's face rule, guarded at the source.
//
// `useControlMode` is a hook over three React contexts (simulation, router search
// params, the door's external store), so what is checked here is the WIRING — that
// the decision itself is delegated to the pure `consoleMode` in simRunControl.ts
// (where simRunControl.test.ts proves every branch) rather than re-inlined as the
// four-clause boolean it used to be, and that the browser-only fact it now depends
// on is read through the sanctioned shape.
//
// The defect behind it: the console's state was a browser fact only. A reloaded tab
// wore the OPS deck while the server still held its five-minute lease, and the one
// control that reaches the console from ops (`guideAction` → "start") was refused by
// that very lease — so the Reset the presenter needed was behind the run they could
// not start.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CRLF-normalized: this checkout is CRLF while the worktree may be LF, and the
// slices below are taken by offset.
const src = readFileSync(new URL("./simControlCenterKit.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const mode = src.slice(src.indexOf("export function useControlMode"), src.indexOf("export const PHASE_ICON"));

test("the face decision is delegated, not re-inlined", () => {
  assert.match(mode, /return consoleMode\(sim, params\.get\("sim"\) === "auto", door\)/, "one rule, in simRunControl.ts");
  assert.doesNotMatch(
    mode,
    /sim\.running \|\| sim\.done \|\| sim\.error !== null \|\| params\.get/,
    "the old inline boolean is what drifted from the door it now has to agree with"
  );
});

test("the tenant's state is read through useSyncExternalStore, with an IDLE server snapshot", () => {
  assert.match(mode, /useSyncExternalStore\(subscribeSimDoor, simDoorSnapshot, \(\) => SIM_DOOR_IDLE\)/);
  // A server snapshot that guessed "a run is live" would hydrate into a mismatch:
  // the door is a client-only fact, and SSR has no session to ask about.
  assert.match(src, /import \{ SIM_DOOR_IDLE, consoleMode, refreshSimDoor, simDoorSnapshot, subscribeSimDoor \} from "\.\/simRunControl"/);
});

test("the door is actually asked — a store nobody fills always reads idle", () => {
  assert.match(mode, /useEffect\(\(\) => \{\s*void refreshSimDoor\(\);\s*\}, \[\]\)/);
});
