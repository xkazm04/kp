// Gig specialist composition and hire (specialist.ts). The hire runs the REAL shared
// hire tail (mintAndDispatch) against a stubbed Personas fetch. unit-db.ts first.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GIG_ARENAS, GIG_DELIVERABLE_CONTRACT, GIG_DELIVERABLE_FENCE } from "./types.ts";
import { gigRecipeSlugs, type ResolvedGigRecipe, type ResolvedGigRecipes } from "./recipes.ts";
import {
  GIG_ARENA_CONNECTORS,
  GIG_DEFAULT_BUDGET_USD,
  GIG_DISCLOSURE_SENTENCE,
  GIG_SPECIALIST_JOB_TITLE_PREFIX,
  cleanNiche,
  composeGigSpecialistSpec,
  gigSpecialistName,
  hireGigSpecialist,
  specialistDispatchSpec,
} from "./specialist.ts";
import { getHiredAgent, getActiveHiredAgentForJob, listHiredAgents } from "../db/agents.ts";
import { listGigSpecialists } from "../db/gigs-specialists.ts";

after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.PERSONAS_BRIDGE_URL;
  delete process.env.PERSONAS_BRIDGE_KEY;
});

function seeded(arena: (typeof GIG_ARENAS)[number]): ResolvedGigRecipes {
  const recipes: ResolvedGigRecipe[] = gigRecipeSlugs(arena).map((slug, i) => ({
    ref: { slug, version: "0.1.0" },
    origin: i === 0 ? "registry" : "seed",
    title: `Title ${slug}`,
    need: `Need ${slug}.`,
    coreAction: i === 0 ? `Core ${slug}.` : null,
    guidance: i === 0 ? `Guidance ${slug}.` : null,
    successCriteria: i === 0 ? [`Criterion A of ${slug}`, `Criterion B of ${slug}`] : [],
  }));
  return { recipes, registry: "unavailable", registryDir: null };
}

test("compose: arena defaults for connectors, family, budget; recipes pinned from the resolution", () => {
  for (const arena of GIG_ARENAS) {
    const spec = composeGigSpecialistSpec({ arena, niche: "  web-app\nauth  " }, seeded(arena));
    assert.equal(spec.arena, arena);
    assert.equal(spec.niche, "web-app auth", "one line, trimmed");
    assert.deepEqual(spec.connectors, [...GIG_ARENA_CONNECTORS[arena]]);
    assert.equal(spec.budgetUsdPerAttempt, GIG_DEFAULT_BUDGET_USD[arena]);
    assert.deepEqual(spec.recipes.map((r) => r.slug), gigRecipeSlugs(arena));
    assert.deepEqual(spec.exemplars, []);
    assert.equal(spec.promptVersion, "gig-specialist.v2");
  }
  assert.deepEqual(GIG_ARENA_CONNECTORS.security, ["research", "source_control"]);
  assert.deepEqual(GIG_ARENA_CONNECTORS.competition, ["research", "ai"]);
});

test("compose: a valid family and budget override are kept, invalid ones fall back", () => {
  const ok = composeGigSpecialistSpec({ arena: "freelance", niche: "copy", taxonomyFamily: "creative_design", budgetUsdPerAttempt: 7.5 }, seeded("freelance"));
  assert.equal(ok.taxonomyFamily, "creative_design");
  assert.equal(ok.budgetUsdPerAttempt, 7.5);
  const bad = composeGigSpecialistSpec({ arena: "freelance", niche: "copy", taxonomyFamily: "wizardry", budgetUsdPerAttempt: -1 }, seeded("freelance"));
  assert.equal(bad.taxonomyFamily, "general_professional");
  assert.equal(bad.budgetUsdPerAttempt, GIG_DEFAULT_BUDGET_USD.freelance);
  assert.equal(composeGigSpecialistSpec({ arena: "competition", niche: "" }, seeded("competition")).taxonomyFamily, "data_ai");
});

test("name is '<Arena> specialist - <niche>' and the niche is bounded", () => {
  assert.equal(gigSpecialistName({ arena: "security", niche: "web-app auth" }), "Security specialist - web-app auth");
  assert.equal(gigSpecialistName({ arena: "oss_bounty", niche: "" }), "Open-source bounty specialist - general");
  assert.equal(cleanNiche("x".repeat(500)).length, 80);
});

test("dispatch spec: mission from the arena recipe, prompt carries recipes, checklist, contract and hard rules", () => {
  const resolved = seeded("oss_bounty");
  const spec = composeGigSpecialistSpec({ arena: "oss_bounty", niche: "rust cli" }, resolved);
  const d = specialistDispatchSpec(spec, resolved.recipes);
  assert.equal(d.name, "Open-source bounty specialist - rust cli");
  assert.equal(d.mission, "Need open-source-bounty-contribution. Core open-source-bounty-contribution.");
  assert.deepEqual(d.connectors, ["source_control", "research"]);
  assert.equal(d.maxBudgetUsd, GIG_DEFAULT_BUDGET_USD.oss_bounty);
  assert.deepEqual(d.successMetrics, []);
  const p = d.systemPromptDraft;
  assert.match(p, /Guidance open-source-bounty-contribution\./);
  assert.match(p, /- Criterion A of open-source-bounty-contribution/);
  for (const slug of gigRecipeSlugs("oss_bounty")) assert.ok(p.includes(`${slug}@0.1.0`), `${slug} section`);
  assert.ok(p.includes(GIG_DELIVERABLE_CONTRACT));
  assert.ok(p.includes("```" + GIG_DELIVERABLE_FENCE), "the fence tag the parser looks for");
  assert.ok(p.includes(GIG_DISCLOSURE_SENTENCE));
  assert.match(p, /bodyUntrusted/);
  assert.match(p, /never instructions/i);
  assert.match(p, /Never send, submit, post, comment/);
  assert.match(p, /- disclosure: /, "the arena checklist, with meanings");
  assert.match(p, /- tests_pass: /);
});

test("the prompt is built from trusted parts only: it has no gig text to leak", () => {
  // composeGigSpecialistSpec takes no gig at all; the listing reaches the persona only
  // as `bodyUntrusted` in a per-attempt assignment (dispatch.ts). This pins the input
  // surface so a future "personalize the prompt with the gig" change has to come here.
  assert.equal(composeGigSpecialistSpec.length, 2);
  assert.equal(specialistDispatchSpec.length, 2);
});

test("hire: mints through mintAndDispatch with jobId '' and a gig jobTitle, then records the specialist", async () => {
  process.env.PERSONAS_BRIDGE_URL = "http://127.0.0.1:9420";
  process.env.PERSONAS_BRIDGE_KEY = "pk_unit_test";
  const bodies: unknown[] = [];
  const workspaceCalls: unknown[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    if (String(url).endsWith("/api/dev/workspaces")) {
      workspaceCalls.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ success: true, data: { id: "pws-comp", name: "Competitions", groupTeamId: "gt-1", created: true } }), { status: 200 });
    }
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ requestId: "pr-gig-1" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const ws = "ws-gig-hire";
  const r = await hireGigSpecialist(ws, { arena: "competition", niche: "tabular" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.reused, false);
  assert.equal(r.requestId, "pr-gig-1");
  assert.equal(r.specialist.hiredAgentId, r.hiredAgentId);
  assert.equal(r.specialist.name, "Competition specialist - tabular");
  assert.equal(r.specialist.spec.arena, "competition");

  const agent = getHiredAgent(r.hiredAgentId, ws)!;
  assert.equal(agent.jobId, "", "no pseudo job id: the hire owns no posting");
  assert.ok(agent.jobTitle.startsWith(`${GIG_SPECIALIST_JOB_TITLE_PREFIX} - `));
  assert.equal(agent.intakeId, null);
  assert.equal(agent.appMaster, null, "not mistaken for an App-master hire");
  assert.equal(agent.status, "pending_approval");
  assert.equal(getActiveHiredAgentForJob("", ws), null, "an empty job id never matches the job idempotency read");

  const sent = bodies[0] as {
    kp: { jobId: string };
    spec: { name: string; systemPromptDraft: string };
    appMaster?: unknown;
    placement?: { workspaceId: string };
  };
  assert.equal(sent.kp.jobId, "");
  assert.equal(sent.spec.name, "Competition specialist - tabular");
  assert.equal(sent.appMaster, undefined);
  // Filed into the arena's Personas workspace, ensured first.
  assert.deepEqual(workspaceCalls[0], { name: "Competitions", description: (workspaceCalls[0] as { description: string }).description });
  assert.match((workspaceCalls[0] as { description: string }).description, /Gigs module/);
  assert.deepEqual(sent.placement, { workspaceId: "pws-comp" });
  assert.deepEqual(r.placement, { workspaceId: "pws-comp" });
  assert.equal(r.placementSkipped, null);

  // Same arena + niche while the hire is live: reused, Personas not asked again.
  const again = await hireGigSpecialist(ws, { arena: "competition", niche: "Tabular" });
  assert.ok(again.ok && again.reused && again.specialist.id === r.specialist.id);
  assert.equal(bodies.length, 1);
  assert.equal(listGigSpecialists(ws).length, 1);
});

test("hire: an older Personas without the workspace route hires WITHOUT a placement and says so", async () => {
  process.env.PERSONAS_BRIDGE_URL = "http://127.0.0.1:9420";
  process.env.PERSONAS_BRIDGE_KEY = "pk_unit_test";
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    if (String(url).endsWith("/api/dev/workspaces")) return new Response("Not Found", { status: 404 });
    bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ requestId: "pr-gig-old" }), { status: 200 });
  }) as typeof fetch;
  const r = await hireGigSpecialist("ws-gig-hire-old", { arena: "freelance", niche: "copywriting" });
  assert.ok(r.ok, "the hire is never blocked on the workspace");
  if (!r.ok) return;
  assert.equal(r.placement, null);
  assert.equal(r.placementSkipped, "personas_route_missing");
  assert.equal(bodies.length, 1);
  assert.equal("placement" in bodies[0]!, false, "no placement key on the wire");
});

test("hire: an injected workspace step that throws still hires, unplaced", async () => {
  process.env.PERSONAS_BRIDGE_URL = "http://127.0.0.1:9420";
  process.env.PERSONAS_BRIDGE_KEY = "pk_unit_test";
  globalThis.fetch = (async () => new Response(JSON.stringify({ requestId: "pr-gig-throw" }), { status: 200 })) as typeof fetch;
  const r = await hireGigSpecialist("ws-gig-hire-throw", { arena: "security", niche: "api" }, undefined, {
    ensureWorkspace: async () => {
      throw new Error("boom");
    },
  });
  assert.ok(r.ok && r.placement === null && r.placementSkipped === "personas_unreachable");
});

test("the prompt's Working directory section: GIG.md first, NOTES.md, deliverable/, never outside, file artifacts relative", () => {
  const resolved = seeded("freelance");
  const spec = composeGigSpecialistSpec({ arena: "freelance", niche: "copy" }, resolved);
  const p = specialistDispatchSpec(spec, resolved.recipes).systemPromptDraft;
  assert.match(p, /## Working directory/);
  assert.match(p, /Read `GIG\.md` first/);
  assert.match(p, /`NOTES\.md`/);
  assert.match(p, /under `deliverable\/`/);
  assert.match(p, /Never read or write outside the working directory/);
  assert.match(p, /kind `file`, with `ref` the path relative to the working directory/);
  assert.equal(spec.promptVersion, "gig-specialist.v2");
});

test("hire: a failed dispatch records no specialist and reports the bridge's code", async () => {
  process.env.PERSONAS_BRIDGE_URL = "http://127.0.0.1:9420";
  process.env.PERSONAS_BRIDGE_KEY = "pk_unit_test";
  globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
  const ws = "ws-gig-hire-fail";
  const r = await hireGigSpecialist(ws, { arena: "security", niche: "web" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.status, 502);
  assert.equal(r.code, "AGENT_BRIDGE_KEY_INVALID");
  assert.ok(r.hiredAgentId);
  assert.equal(getHiredAgent(r.hiredAgentId!, ws)!.status, "failed");
  assert.equal(listGigSpecialists(ws).length, 0);
  assert.equal(listHiredAgents(ws).length, 1);
});
