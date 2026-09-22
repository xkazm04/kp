import { test } from "node:test";
import assert from "node:assert/strict";
import { runningTitleProgress } from "@/app/features/shell/workspaceDocumentTitle";

test("browser title uses a running task's bounded progress", () => {
  assert.equal(runningTitleProgress([
    { status: "queued", progressDone: 0, progressTotal: 10 },
    { status: "running", progressDone: 4, progressTotal: 10 },
  ]), "4/10");
  assert.equal(runningTitleProgress([{ status: "running", progressDone: 15, progressTotal: 10 }]), "10/10");
});

test("unknown totals and non-running tasks do not claim progress", () => {
  assert.equal(runningTitleProgress([{ status: "running", progressDone: 2, progressTotal: 0 }]), null);
  assert.equal(runningTitleProgress([{ status: "succeeded", progressDone: 10, progressTotal: 10 }]), null);
});
