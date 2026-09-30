// The accept loop as the tab watches it (logic/loop.ts): each state from the two task rows,
// the research task's continuation read off its result, and the flash sentence per answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loopSettled, loopState, plansTaskId, queuedKey, type LoopTask, type LoopWatch } from "./loop.ts";

const task = (status: string, result: Record<string, unknown> | null = null): LoopTask => ({ status, result });
const watch = (over: Partial<LoopWatch>): LoopWatch => ({ gigId: "g1", title: "A gig", research: "t-r", plans: "after_research", researchTask: null, plansTask: null, ...over });

test("research first, then the plans task the research run continued as", () => {
  assert.equal(loopState(watch({})), "research_queued");
  assert.equal(loopState(watch({ researchTask: task("running") })), "research_running");
  const researched = task("succeeded", { llm: 1, plansTask: "t-p" });
  assert.equal(plansTaskId(watch({ researchTask: researched })), "t-p");
  assert.equal(loopState(watch({ researchTask: researched })), "plans_queued");
  assert.equal(loopState(watch({ researchTask: researched, plansTask: task("running") })), "plans_running");
  const done = watch({ researchTask: researched, plansTask: task("succeeded", { ready: 1, failed: 0 }) });
  assert.equal(loopState(done), "ready");
  assert.equal(loopSettled(done), true);
});

test("research that queued no plans stopped the loop; a failed step or an all-failed round is a failure", () => {
  assert.equal(loopState(watch({ researchTask: task("succeeded", { plansTask: null }) })), "stopped", "declined as physical, or quarantined");
  assert.equal(loopState(watch({ researchTask: task("interrupted") })), "failed");
  const keyless = watch({ researchTask: task("succeeded", { plansTask: "t-p" }), plansTask: task("succeeded", { ready: 0, failed: 1 }) });
  assert.equal(loopState(keyless), "failed", "no seat wrote a plan: never 'written'");
  assert.equal(loopSettled(watch({ researchTask: task("running") })), false);
});

test("plans queued straight away, research alone, and nothing queued", () => {
  assert.equal(loopState(watch({ research: null, plans: "t-p" })), "plans_queued");
  assert.equal(loopState(watch({ research: null, plans: "t-p", plansTask: task("succeeded", { ready: 3 }) })), "ready");
  assert.equal(loopState(watch({ plans: null, researchTask: task("succeeded", {}) })), "researched");
  assert.equal(loopState(watch({ research: null, plans: null })), null);
});

test("the flash sentence names what was queued", () => {
  assert.equal(queuedKey({ research: "t", plans: "after_research" }), "both");
  assert.equal(queuedKey({ research: null, plans: "t" }), "plans");
  assert.equal(queuedKey({ research: "t", plans: null }), "research");
  assert.equal(queuedKey({ research: null, plans: null }), "none");
  assert.equal(queuedKey(null), "none");
});
