// The gig runners on the late-bound seam (late-bound-boot.ts) and the clock handlers in
// instrumentation-node.ts. unit-db.ts must be the first project import.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerLateBoundImplementations } from "../late-bound-boot.ts";
import { _resetTaskRunnersForTests, externalRunner } from "../task-external-runners.ts";

after(() => cleanupUnitDb());

test("gig_scan, gig_sync, gig_research, gig_plans, gig_report and gig_proposal are registered at boot", () => {
  const kinds = ["gig_scan", "gig_sync", "gig_research", "gig_plans", "gig_report", "gig_proposal"];
  _resetTaskRunnersForTests();
  for (const kind of kinds) assert.throws(() => externalRunner(kind), /not registered/, kind);
  registerLateBoundImplementations();
  for (const kind of kinds) assert.equal(typeof externalRunner(kind), "function", kind);
});

test("the gig_sync runner is the real sync, scoped to the enqueuing workspace", async () => {
  registerLateBoundImplementations();
  const summary = (await externalRunner("gig_sync")({
    workspaceId: "ws-gig-boot-empty",
    signal: new AbortController().signal,
    progress: () => {},
    params: {},
  })) as { checked: number; drafted: number; outcomes: { checked: number } };
  assert.equal(summary.checked, 0);
  assert.equal(summary.drafted, 0);
  assert.equal(summary.outcomes.checked, 0, "the pollers ran and found nothing sent");
});

test("the heavy gig modules are reached only lazily - never statically from the boot list or the hubs", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const boot = read("../late-bound-boot.ts");
  assert.match(boot, /await import\("\.\/gigs\/scan"\)/);
  assert.match(boot, /qualify: qualifyGigHook/, "the manual scan runs with the qualifier plugged in");
  // gig-mastery: research leaves the scan for its own task, and the plan runner is late-bound too.
  assert.match(boot, /startTask\("gig_research", gigResearchTaskParams\(ws, req\), ws\)/, "the scan ENQUEUES its research");
  assert.match(boot, /await import\("\.\/gigs\/research"\)/);
  assert.match(boot, /await import\("\.\/gigs\/plans"\)/);
  assert.match(boot, /await import\("\.\/gigs\/sync"\)/);
  // WP4: the outcome pollers ride the same sync runner, after the Personas sync.
  assert.match(boot, /await import\("\.\/gigs\/pollers"\)/);
  assert.match(boot, /pollGigOutcomes\(ctx\.workspaceId\)/, "the pollers are scoped to the enqueuing workspace");
  // The TWO static gigs imports the boot list may carry: the report's and the proposal's
  // trigger registries, leaves with nothing but type imports (so they add no module to any
  // graph); their runners are lazy.
  assert.match(boot, /await import\("\.\/gigs\/report\/run"\)/);
  assert.match(boot, /await import\("\.\/gigs\/proposal\/run"\)/);
  assert.doesNotMatch(read("./report/trigger.ts"), /^import (?!type )/m, "the trigger registry stays a leaf");
  assert.doesNotMatch(read("./proposal/trigger.ts"), /^import (?!type )/m, "the proposal trigger registry stays a leaf");
  const rest = boot
    .replace(/^import \{ registerGigReportEnqueuer \} from "\.\/gigs\/report\/trigger";$/m, "")
    .replace(/^import \{ registerGigProposalEnqueuer \} from "\.\/gigs\/proposal\/trigger";$/m, "");
  assert.doesNotMatch(rest, /^import .*gigs\//m);
  for (const hub of ["../tasks.ts", "../db/pipeline.ts"]) assert.doesNotMatch(read(hub), /gigs\/(scan|sync|dispatch|specialist|research|plans|report|proposal)/,`${hub} must not reach a gig runner`);
  const clock = readFileSync(fileURLToPath(new URL("../../../instrumentation-node.ts", import.meta.url)), "utf8");
  assert.match(clock, /gig_scan: async \(\) =>/);
  assert.match(clock, /gig_sync: async \(\) =>/);
  // The clock runs the SAME registered runner as the manual door (the qualifier, the expiry
  // sweep and the research enqueue included), so the two cannot drift apart.
  assert.match(clock, /externalRunner\("gig_scan"\)\(\{ workspaceId: ws,/, "the clock scan is the manual one");
  assert.match(clock, /pollGigOutcomes\(ws\)/, "the clock sync asks the outcome pollers too");
  for (const hub of ["../tasks.ts", "../db/pipeline.ts"]) assert.doesNotMatch(read(hub), /gigs\/pollers/, `${hub} must not reach the pollers`);
});
