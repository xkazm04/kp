import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONTROL_ROOM_HREF, controlRoomDoor } from "./controlDoor.ts";

// Council lite r1 (value): nothing in the tree linked to /control, the page that holds the
// Art. 22 gates. The door must exist for an operator and leave NO trace for anyone else.

test("an operator is handed the /control door", () => {
  assert.deepEqual(controlRoomDoor(true), { href: "/control" });
  assert.equal(CONTROL_ROOM_HREF, "/control");
});

test("a non-operator is handed nothing — no href, so nothing to render", () => {
  assert.equal(controlRoomDoor(false), null);
});

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

test("both rails draw the door only through controlRoomDoor(), fed by the operator flag", () => {
  const server = read("../WorkspaceNav.tsx");
  assert.match(server, /controlRoomDoor\(operator\)/, "the server nav gates on the isOperator() it already resolved");
  assert.match(server, /controlDoor \? <NavControlLink/, "and renders the link only when the door exists");
  const drawer = read("../WorkspaceNavDrawer.tsx");
  assert.match(drawer, /controlRoomDoor\(operator\)/);
  assert.match(drawer, /controlDoor \? <NavControlLink/);
});

test("the page keeps its own notFound() gate on the same predicate the door uses", () => {
  const page = read("../../../control/page.tsx");
  assert.match(page, /if \(!\(await isOperator\(\)\)\) notFound\(\);/);
});

test("the SPA mount at '/' hands <Workspace> the operator flag, resolved by isOperator()", () => {
  const page = read("../../../page.tsx");
  assert.match(page, /<Workspace[^>]*operator=\{operator\}/, "the <Workspace mount passes operator=");
  assert.match(page, /operator\] = await Promise\.all\([^;]*isOperator\(\)/, "and the value comes from isOperator()");
});
