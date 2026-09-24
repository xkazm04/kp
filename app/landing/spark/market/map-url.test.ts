import { test } from "node:test";
import assert from "node:assert/strict";
import { marketMapSelection } from "./map-url.ts";

test("market map links accept known regions and metrics and discard unknown values", () => {
  assert.deepEqual(marketMapSelection("CZ010", "salary"), { region: "CZ010", metric: "salary" });
  assert.deepEqual(marketMapSelection("invalid", "other"), { region: "CZ010", metric: "volume" });
  assert.deepEqual(marketMapSelection(["CZ010", "CZ020"], ["salary"]), { region: "CZ010", metric: "volume" });
});
