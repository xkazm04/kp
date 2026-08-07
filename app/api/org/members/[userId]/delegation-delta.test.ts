// Delegation guard for PATCH /api/org/members/[userId] capability edits. The
// client re-sends the whole desired capability set and the route recomputes the
// full override, then caps grants to what the actor can delegate. The bug: that
// cap was applied to the FULL recompute, so a partial delegate (members:manage
// without team:manage) toggling one unrelated switch silently stripped a
// teammate's pre-existing team:manage grant. The fix caps delegation to the
// DELTA — a grant survives if the actor can delegate it OR it already existed on
// the member (membership.overrides.grant).
//
// The route runs behind cookie auth (currentUser/callerCapabilities), so this is
// a SOURCE GUARD that the delta rule is in place; org-service.test.ts covers the
// service-layer permission mechanics.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

test("capability delegation is capped to the delta, preserving pre-existing grants", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(dir, "route.ts"), "utf8");
  // The route must read the member's current grants...
  assert.match(src, /membership\.overrides\?\.grant/, "must read the member's pre-existing grants");
  // ...and allow a grant that is either delegable by the actor OR pre-existing.
  assert.match(
    src,
    /actorCaps\.has\(c\)\s*\|\|\s*preExistingGrants\.has\(c\)/,
    "grants must survive when the actor can delegate them OR they pre-existed",
  );
});
