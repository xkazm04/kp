// Pins the single-source tab-id contract (idea-bd5196ea): the WorkspaceTabId
// union, the runtime guard (isWorkspaceTabId), and the nav structure must all
// agree because they derive from ONE canonical array. The bug this guards
// against is silent drift — a real tab id missing from the runtime allowlist, so
// a deep link to a valid tab 404s to the default with no error.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TAB,
  isWorkspaceTabId,
  NAV_GROUPS,
  tabHref,
  WORKSPACE_TAB_IDS,
} from "./tabs.ts";

test("every canonical tab id passes the runtime guard (union ↔ guard cannot drift)", () => {
  for (const id of WORKSPACE_TAB_IDS) {
    assert.equal(isWorkspaceTabId(id), true, `${id} must pass isWorkspaceTabId`);
  }
});

test("the canonical array has no duplicate ids", () => {
  assert.equal(new Set(WORKSPACE_TAB_IDS).size, WORKSPACE_TAB_IDS.length);
});

test("isWorkspaceTabId rejects non-members and nullish input", () => {
  for (const bad of ["nope", "Pipeline", "", "tab", null, undefined]) {
    assert.equal(isWorkspaceTabId(bad), false, `${String(bad)} should be rejected`);
  }
});

test("the default tab is itself a valid tab id", () => {
  assert.equal(isWorkspaceTabId(DEFAULT_TAB), true);
});

test("every NAV_GROUPS item id is a valid tab id", () => {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      assert.equal(isWorkspaceTabId(item.id), true, `nav item ${item.id} must be a valid tab id`);
    }
  }
});

test("history and tasks are valid ids but intentionally absent from NAV_GROUPS", () => {
  const navIds = new Set(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id)));
  for (const id of ["history", "tasks"] as const) {
    assert.equal(isWorkspaceTabId(id), true, `${id} is a valid tab id`);
    assert.equal(navIds.has(id), false, `${id} is not a deep-link nav target`);
  }
});

test("tabHref points the default tab at / and every other tab at /?tab=<id>", () => {
  assert.equal(tabHref(DEFAULT_TAB), "/");
  for (const id of WORKSPACE_TAB_IDS) {
    if (id === DEFAULT_TAB) continue;
    assert.equal(tabHref(id), `/?tab=${id}`);
  }
});
