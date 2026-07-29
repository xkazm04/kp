// no-silent-lifecycle-states — source guards for two states the jobs surface used to
// swallow. Both are client/route wiring behind cookie auth, so they're asserted at the
// source level (the same style as close-tenancy.test.ts).
//
//  1. close's withdrawal step is best-effort; when it THREW, the response was still
//     ok:true/withdrawn:0 and the modal rendered nothing — "empty funnel" and
//     "withdrawal broke" were one silent state. The route now reports withdrawalFailed
//     and the modal renders both cases (the zero case wires jobs.posting.closedNow,
//     which was translated in every catalog and referenced nowhere).
//  2. a ?job= deep link whose target sits outside the ranked LIMIT-300 list slice used
//     to stamp the once-per-param guard and do nothing. The tab now point-fetches the
//     job by id and only shows "not found" when that 404s.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(path.join(dir, ...p), "utf8");

test("POST /api/jobs/[id]/close distinguishes a failed withdrawal from a genuine zero", () => {
  const src = read("[id]", "close", "route.ts");
  assert.match(src, /withdrawalFailed = true/, "the withdrawal catch must record the failure");
  assert.match(src, /NextResponse\.json\(\{[^}]*withdrawalFailed[^}]*\}\)/, "the close response must carry withdrawalFailed");
});

test("the posting modal renders the zero-withdrawal and failed-withdrawal close states", () => {
  // The modal is split across a logic hook (state + the close call) and a footer
  // (the rendered outcome), so the two halves of this contract are asserted where
  // each now lives.
  const logic = read("..", "..", "features", "library", "jobs", "jobsPostingModalLogic.ts");
  assert.match(logic, /withdrawalFailed\?: boolean/, "the modal must read the route's failure flag");
  const footer = read("..", "..", "features", "library", "jobs", "JobsPostingModalFooter.tsx");
  assert.match(footer, /t\("withdrawFailed"\)/, "a failed withdrawal must be surfaced");
  assert.match(footer, /t\("closedNow"\)/, "withdrawn:0 must still confirm the close (the orphan key)");
});

test("GET /api/jobs/[id] exists and is scoped like the list query", () => {
  const src = read("[id]", "route.ts");
  assert.match(src, /export async function GET/);
  assert.match(src, /jobVisibleToWorkspace\(id, ws\)/, "a point-fetch must not hand out what the list wouldn't");
  assert.match(src, /status: 404/, "an invisible/unknown job must 404, not leak existence");
});

test("the Jobs tab falls back to the by-id fetch when a ?job= deep link misses the slice", () => {
  // Deep-link resolution lives in the tab's extracted hook; the notice it drives is
  // rendered by the tab itself.
  const hook = read("..", "..", "features", "library", "jobs", "jobsTabDeepLink.ts");
  assert.match(hook, /fetch\(`\/api\/jobs\/\$\{encodeURIComponent\(lookupId\)\}`\)/, "the miss must point-fetch the target");
  assert.match(hook, /setLookupMissed\(true\)/, "only a failed point-fetch is a real miss");
  const tab = read("..", "..", "features", "library", "jobs", "JobsTab.tsx");
  assert.match(tab, /td\("notFound"\)/, "a real miss must be told to the user");
});
