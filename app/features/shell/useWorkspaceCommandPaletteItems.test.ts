// Pins the Tasks palette action. `tasks` is a valid tab id the footer opens,
// but tabs.test.ts keeps it out of NAV_GROUPS, and the palette's navigator
// walks only that list — so ⌘K would never offer the ledger a flight note
// keeps promising. tasksPaletteItem is the pure half of that door.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tasksPaletteItem } from "./useWorkspaceCommandPaletteItems.ts";

test("an empty query includes action-tasks", () => {
  const item = tasksPaletteItem("", "AI tasks", "");
  assert.equal(item?.key, "action-tasks");
  assert.match(item?.href ?? "", /(?:\?|&)tab=tasks(?:&|$)/);
});

test("typing the localized label keeps action-tasks", () => {
  assert.equal(tasksPaletteItem("úlohy", "Úlohy AI", "")?.key, "action-tasks");
  assert.equal(tasksPaletteItem("ai tasks", "AI tasks", "")?.key, "action-tasks");
  assert.equal(tasksPaletteItem("background", "AI tasks", "")?.key, "action-tasks");
});

test("a query that matches neither the label nor the hunt tokens hides it", () => {
  assert.equal(tasksPaletteItem("pipeline", "AI tasks", ""), null);
});
