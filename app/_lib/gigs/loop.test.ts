// The accept loop's decisions (loop.ts) over recorders: research first when the brief is
// missing or stale, plans after it (or now), nothing past an existing round, the research
// pass's continuation stops for a gig research declined or quarantined, and the flags a
// stored task row carries are read as untrusted. Pure: no DB, no task hub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { continueGigLoop, GIG_LOOP_BRIEF_VERSION, gigLoopResearchParams, gigLoopSteps, gigNeedsResearch, gigsReadyForPlans, parseGigLoopTaskParams, startGigLoop, type GigLoopDeps } from "./loop.ts";
import type { Gig, GigBrief, GigStatus } from "./types.ts";

const brief = (over: Partial<GigBrief> = {}) => ({ source: "llm", promptVersion: GIG_LOOP_BRIEF_VERSION, ...over }) as GigBrief;
const gig = (id: string, status: GigStatus, b: GigBrief | null) => ({ id, status, brief: b }) as Pick<Gig, "id" | "status" | "brief">;

function recorder(rounds: string[] = []) {
  const calls: string[] = [];
  const deps: GigLoopDeps = {
    hasPlanRound: (_ws, id) => rounds.includes(id),
    enqueueResearch: (ws, id) => (calls.push(`research:${ws}:${id}`), "t-research"),
    enqueuePlans: (ws, ids) => (calls.push(`plans:${ws}:${ids.join(",")}`), "t-plans"),
  };
  return { calls, deps };
}

test("the brief version is the research prompt's, in lockstep", () => {
  const src = readFileSync(fileURLToPath(new URL("./research.ts", import.meta.url)), "utf8");
  assert.match(src, new RegExp(`export const GIG_BRIEF_PROMPT_VERSION = "${GIG_LOOP_BRIEF_VERSION}"`));
});

test("research is needed with no brief, a deterministic one or an older prompt's", () => {
  assert.equal(gigNeedsResearch({ brief: null }), true);
  assert.equal(gigNeedsResearch({ brief: brief({ source: "deterministic" }) }), true);
  assert.equal(gigNeedsResearch({ brief: brief({ promptVersion: "gig-brief-v3" }) }), true);
  assert.equal(gigNeedsResearch({ brief: brief() }), false, "a v4 model brief is current");
});

test("accept enqueues research, then plans after it", () => {
  const r = recorder();
  assert.deepEqual(startGigLoop("ws-1", gig("g1", "qualified", null), r.deps), { research: "t-research", plans: "after_research" });
  assert.deepEqual(r.calls, ["research:ws-1:g1"], "plans are NOT enqueued yet: the research task continues to them");
});

test("a current brief skips research and queues plans now; an existing round queues no plans", () => {
  const r = recorder();
  assert.deepEqual(startGigLoop("ws-1", gig("g1", "qualified", brief()), r.deps), { research: null, plans: "t-plans" });
  assert.deepEqual(r.calls, ["plans:ws-1:g1"]);
  const withRound = recorder(["g2"]);
  assert.deepEqual(startGigLoop("ws-1", gig("g2", "qualified", brief()), withRound.deps), { research: null, plans: null });
  assert.deepEqual(withRound.calls, []);
  assert.deepEqual(gigLoopSteps({ brief: null }, true), { research: true, plans: "none" }, "a stale brief is still refreshed");
});

test("after research: plans only for gigs still qualified, briefed and with no round - a decline or a quarantine stops the loop", () => {
  const byId: Record<string, Pick<Gig, "id" | "status" | "brief">> = {
    ok: gig("ok", "qualified", brief()),
    physical: gig("physical", "declined", brief({ workKind: "physical" })),
    honeypot: gig("honeypot", "suspect", brief({ source: "deterministic" })),
    planned: gig("planned", "qualified", brief()),
    unbriefed: gig("unbriefed", "qualified", null),
  };
  const r = recorder(["planned"]);
  const ids = ["ok", "physical", "honeypot", "planned", "unbriefed", "gone", "ok"];
  assert.equal(continueGigLoop("ws-1", ids, { ...r.deps, getGig: (_ws, id) => byId[id] ?? null }), "t-plans");
  assert.deepEqual(r.calls, ["plans:ws-1:ok"]);
  const stopped = recorder();
  assert.equal(continueGigLoop("ws-1", ["physical"], { ...stopped.deps, getGig: (_ws, id) => byId[id] ?? null }), null);
  assert.deepEqual(stopped.calls, [], "a declined physical gig never reaches plans");
  assert.deepEqual(gigsReadyForPlans([null], () => false), []);
});

test("the research task carries the loop's flags; a stored row's are read strictly", () => {
  const p = gigLoopResearchParams("ws-1", "g1");
  assert.deepEqual(p, { workspaceId: "ws-1", sourceId: null, gigIds: ["g1"], linksByGigId: {}, refresh: true, thenPlans: true });
  assert.deepEqual(parseGigLoopTaskParams(p), { refresh: true, thenPlans: true });
  assert.deepEqual(parseGigLoopTaskParams({ refresh: "true", thenPlans: 1 }), { refresh: false, thenPlans: false }, "only a real true counts");
  assert.deepEqual(parseGigLoopTaskParams({}), { refresh: false, thenPlans: false }, "a scan's pass is not the loop");
});
