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

test("gig_scan and gig_sync are registered at boot", () => {
  _resetTaskRunnersForTests();
  assert.throws(() => externalRunner("gig_scan"), /not registered/);
  assert.throws(() => externalRunner("gig_sync"), /not registered/);
  registerLateBoundImplementations();
  assert.equal(typeof externalRunner("gig_scan"), "function");
  assert.equal(typeof externalRunner("gig_sync"), "function");
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
  assert.match(boot, /await import\("\.\/gigs\/sync"\)/);
  // WP4: the outcome pollers ride the same sync runner, after the Personas sync.
  assert.match(boot, /await import\("\.\/gigs\/pollers"\)/);
  assert.match(boot, /pollGigOutcomes\(ctx\.workspaceId\)/, "the pollers are scoped to the enqueuing workspace");
  assert.doesNotMatch(boot, /^import .*gigs\//m);
  for (const hub of ["../tasks.ts", "../db/pipeline.ts"]) assert.doesNotMatch(read(hub), /gigs\/(scan|sync|dispatch|specialist)/, `${hub} must not reach a gig runner`);
  const clock = readFileSync(fileURLToPath(new URL("../../../instrumentation-node.ts", import.meta.url)), "utf8");
  assert.match(clock, /gig_scan: async \(\) =>/);
  assert.match(clock, /gig_sync: async \(\) =>/);
  assert.match(clock, /qualify: qualifyGigHook/, "the clock scan qualifies exactly like the manual one");
  assert.match(clock, /pollGigOutcomes\(ws\)/, "the clock sync asks the outcome pollers too");
  for (const hub of ["../tasks.ts", "../db/pipeline.ts"]) assert.doesNotMatch(read(hub), /gigs\/pollers/, `${hub} must not reach the pollers`);
});
