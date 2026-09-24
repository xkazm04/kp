import { test } from "node:test";
import assert from "node:assert/strict";
import { filterableTaskKinds } from "@/app/features/shell/tasks/taskKinds";

test("kind filter offers registered kinds absent from the recent window", () => {
  assert.deepEqual(filterableTaskKinds(["analysis", "repo_scan"], []), ["analysis", "repo_scan"]);
});

test("kind filter retains legacy kinds present in the recent window", () => {
  assert.deepEqual(filterableTaskKinds(["analysis"], [{ kind: "old_kind" }, { kind: "analysis" }]), ["analysis", "old_kind"]);
});
