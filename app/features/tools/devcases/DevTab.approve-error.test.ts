// approve() on the Define-need flow must surface failures like every other write
// on DevTab (dev-case-authoring-publishing #2). It used to do a bare fetch and act
// only `if (r.ok)`, so a probe-gate block (POST /api/devcase -> enforceProbeGate,
// a structured error+code+verdict) spun and then did nothing — no banner, no
// explanation, a dead button. This pins that approve() goes through the shared
// runAction error surface instead of a bare r.ok fetch.
//
// approve() was split out of DevTab.tsx into useDevTabNeedAnalysis.ts (the
// Define-need workspace's need-analysis → design → approve hook) as part of the
// feature-structure refactor's 200-line split; this test now reads that file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "useDevTabNeedAnalysis.ts"), "utf8");
// Isolate the approve() function body.
const start = src.indexOf("const approve = async");
assert.ok(start >= 0, "approve() must exist");
const body = src.slice(start, src.indexOf("return {", start));

test("approve() routes through runAction (shared error surface), not a bare r.ok fetch", () => {
  // The first argument is an ACTION ID, not a label: the failure banner's sentence is
  // built from `devcase.studio.action.approve` in the reader's own language, so the
  // English word "Approve" no longer travels through this call.
  assert.match(body, /runAction\(\s*["']approve["']/, "approve() must call runAction('approve', …)");
  // The old dead-button pattern was a bare `if (r.ok) {` gate with no error branch.
  assert.doesNotMatch(body, /if \(r\.ok\)\s*\{/, "approve() must not gate silently on a bare r.ok check");
});
