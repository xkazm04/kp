// The approve route must not silently drop reviewer edits (dev-lifecycle-cohort
// -outcomes #1). The approve block is wrapped in if (isAtReviewGate(lc.stage)); it
// previously had no else, so when the lifecycle had already moved past the gate (a
// second tab/reviewer approved, or a retry landed twice) the edits, probe gate, and
// audit were all skipped yet the route still returned { ok: true }. The reviewer's
// corrections vanished with a false success signal. This pins the else-if branch
// that 409s when off-gate edits arrive, mirroring the redesign route.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");

test("off-gate reviewer edits are rejected with 409, not silently dropped", () => {
  // There must be an else-branch to the review-gate conditional that handles edits.
  assert.match(src, /}\s*else if \(edits\)\s*{/, "the review-gate conditional must have an else-if (edits) branch");
  // That branch must 409 with the current stage, not fall through to { ok: true }.
  assert.match(src, /status:\s*409/, "off-gate edits must return 409");
  assert.match(src, /not awaiting review/i, "the 409 must explain the lifecycle moved past review");
  // The message must reference the stage so the client can surface "already approved elsewhere".
  assert.match(src, /stage:\s*lc\.stage/, "the 409 body must carry the current stage");
});

// The timebox is the cap on the candidate's UNPAID work (2h, UAT M8), enforced in the
// Python designer but NOT here: this validator accepted anything up to 80 hours, so a
// reviewer typo at the gate minted an over-policy exercise that renders verbatim to the
// candidate. The route can't be imported (Next only allows handler exports), so pin the
// contract on the source: the shared clamp, no re-typed literal, and the clamp surfaced
// in the audit reason the reviewer reads.
test("the approve gate clamps a reviewer-edited timebox to the shared cap", () => {
  assert.doesNotMatch(src, /timeboxHours\s*<=\s*80/, "the 80h ceiling must be gone");
  assert.match(src, /clampTimeboxHours/, "the timebox must go through the shared clamp");
  assert.match(src, /from "@\/app\/_lib\/devcase-timebox"/, "the bound must be imported, not re-typed");
  assert.match(src, /timeboxClamped/, "a clamped edit must be distinguishable from an accepted one");
  assert.match(src, /timebox clamped to the/, "the clamp must reach the reviewer's audit trail");
});
