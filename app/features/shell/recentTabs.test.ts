import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceRecentTabs } from "./recentTabs.ts";

test("visiting a tab moves it to the front and keeps the three most recent", () => {
  assert.deepEqual(advanceRecentTabs(["pipeline", "jobs", "library"], "jobs"), ["jobs", "pipeline", "library"]);
  assert.deepEqual(advanceRecentTabs(["pipeline", "jobs", "library"], "decisions"), ["decisions", "pipeline", "jobs"]);
});
