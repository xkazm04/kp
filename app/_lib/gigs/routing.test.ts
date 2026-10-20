// Gig routing (routing.ts): the operator's override of the matcher, on an isolated
// throwaway DB. unit-db.ts must be the first project import.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { Gig, GigSpecialist } from "./types.ts";
import { routeGig, unrouteGig } from "./routing.ts";
import { qualifyAndMatch } from "./qualify.ts";
import { getGig, setGigRoute, transitionGig, upsertGigFromRaw } from "../db/gigs.ts";
import { createGigSpecialist } from "../db/gigs-specialists.ts";
import { createHiredAgent, updateHiredAgentStatus, type AgentStatus } from "../db/agents.ts";

after(() => cleanupUnitDb());

const WS = "ws-gig-routing";
let seq = 0;

function newGig(over: { arena?: Gig["arena"]; title?: string; tags?: string[]; suspect?: boolean } = {}): Gig {
  seq += 1;
  return upsertGigFromRaw(WS, {
    sourceId: "gsrc-r",
    arena: over.arena ?? "freelance",
    raw: {
      externalKey: `r-${seq}`,
      url: `https://example.test/r/${seq}`,
      title: over.title ?? `Routing ${seq}`,
      org: null,
      reward: { amount: 300, currency: "USD", text: "$300" },
      deadlineAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      postedAt: null,
      bodyText: "Do the work.",
      bodyHtml: null,
      tags: over.tags ?? [],
    },
    suspectReasons: over.suspect ? ["hidden_instructions"] : [],
  }).gig;
}

function hire(niche: string, over: { arena?: Gig["arena"]; status?: AgentStatus; ws?: string } = {}): GigSpecialist {
  const ws = over.ws ?? WS;
  const status = over.status ?? "active";
  const agent = createHiredAgent({ jobTitle: "Gig specialist - test", spec: {} }, ws);
  updateHiredAgentStatus(agent.id, status, { personaId: `p-${agent.id}` }, ws);
  return createGigSpecialist(ws, {
    hiredAgentId: agent.id,
    name: `Spec ${niche}`,
    spec: {
      arena: over.arena ?? "freelance",
      niche,
      taxonomyFamily: "general_professional",
      recipes: [],
      exemplars: [],
      connectors: [],
      budgetUsdPerAttempt: 3,
      promptVersion: "gig-specialist.v3",
    },
    registry: "unavailable",
  });
}

// The roster every test shares: two ready freelance specialists, oldest first.
const web = hire("web development");
const ai = hire("AI consulting and technical reports");

function moveTo(gig: Gig, path: Gig["status"][]): Gig {
  let cur = gig;
  for (const to of path) {
    const r = transitionGig(WS, cur.id, { from: cur.status, to });
    assert.ok(r.ok, `${cur.status} -> ${to}`);
    if (r.ok) cur = r.gig;
  }
  return cur;
}

test("route: a new gig nothing matched goes to the chosen specialist, takes its niche, and is re-qualified", () => {
  const gig = newGig({ title: "Feasibility study for a sales team" });
  const q = qualifyAndMatch(WS, gig.id);
  assert.ok(q.ok && q.specialistId === null && !q.moved, "no niche word in the gig: the matcher picks nobody");

  const r = routeGig(WS, gig.id, ai.id);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.gig.specialistId, ai.id);
  assert.equal(r.gig.niche, "AI consulting and technical reports");
  assert.equal(r.gig.status, "qualified", "routed, the gig now clears the bar");
  assert.equal(r.gig.qualification?.factors.arenaFit, true);
});

test("route: a later ranking keeps the operator's choice (the routed niche scores 100)", () => {
  const gig = newGig({ tags: ["Web Development"] });
  const r = routeGig(WS, gig.id, ai.id);
  assert.ok(r.ok);
  assert.equal(getGig(WS, gig.id)!.specialistId, ai.id, "the web-tagged gig stays with the specialist it was routed to");
});

test("route: allowed from qualified, drafted and in_review; refused while dispatched, suspect or off the line", () => {
  const q = moveTo(newGig(), ["qualified"]);
  assert.ok(routeGig(WS, q.id, web.id).ok);
  const d = moveTo(newGig(), ["qualified", "dispatched", "drafted"]);
  assert.ok(routeGig(WS, d.id, web.id).ok);
  const ir = moveTo(newGig(), ["qualified", "dispatched", "drafted", "in_review"]);
  assert.ok(routeGig(WS, ir.id, web.id).ok);

  for (const [label, gig] of [
    ["dispatched", moveTo(newGig(), ["qualified", "dispatched"])],
    ["suspect", newGig({ suspect: true })],
    ["declined", moveTo(newGig(), ["declined"])],
  ] as const) {
    const r = routeGig(WS, gig.id, web.id);
    assert.ok(!r.ok && r.code === "GIG_ACTION_NOT_ALLOWED" && r.status === 409, label);
    assert.equal(getGig(WS, gig.id)!.specialistId, gig.specialistId, `${label}: nothing written`);
    const u = unrouteGig(WS, gig.id);
    assert.ok(!u.ok && u.code === "GIG_ACTION_NOT_ALLOWED", `${label}: unroute refused too`);
  }
});

test("route: another arena's specialist is refused GIG_ROUTE_ARENA_MISMATCH", () => {
  const oss = hire("web development", { arena: "oss_bounty" });
  const gig = newGig();
  const r = routeGig(WS, gig.id, oss.id);
  assert.ok(!r.ok && r.code === "GIG_ROUTE_ARENA_MISMATCH" && r.status === 409);
  assert.equal(getGig(WS, gig.id)!.niche, null);
});

test("route: a hire that is not runnable, a missing or foreign specialist, a foreign gig", () => {
  const pending = hire("data analysis", { status: "pending_approval" });
  const gig = newGig();
  const r = routeGig(WS, gig.id, pending.id);
  assert.ok(!r.ok && r.code === "GIG_SPECIALIST_NOT_READY");
  if (!r.ok && r.code === "GIG_SPECIALIST_NOT_READY") assert.equal(r.detail, "hire_pending_approval");

  const foreign = hire("web development", { ws: "ws-someone-else" });
  const f = routeGig(WS, gig.id, foreign.id);
  assert.ok(!f.ok && f.code === "GIG_SPECIALIST_NOT_READY");
  if (!f.ok && f.code === "GIG_SPECIALIST_NOT_READY") assert.equal(f.detail, "no_specialist", "another workspace's specialist reads as absent");
  const missing = routeGig(WS, gig.id, "gspec-nope");
  assert.ok(!missing.ok && missing.code === "GIG_SPECIALIST_NOT_READY");

  assert.deepEqual(routeGig("ws-someone-else", gig.id, web.id), { ok: false, code: "GIG_NOT_FOUND", status: 404 });
  assert.equal(getGig(WS, gig.id)!.specialistId, null);
});

test("unroute: clears the niche and hands the gig back to the matcher's pick", () => {
  const gig = moveTo(newGig({ tags: ["Website", "HTML"] }), ["qualified"]);
  assert.ok(routeGig(WS, gig.id, ai.id).ok);
  const u = unrouteGig(WS, gig.id);
  assert.ok(u.ok);
  if (!u.ok) return;
  assert.equal(u.gig.niche, null);
  assert.equal(u.gig.specialistId, web.id, "the web-tagged gig goes back to the web specialist");
  assert.equal(u.gig.status, "qualified", "a qualified gig keeps its status");

  const nothing = moveTo(newGig({ title: "Knit a scarf" }), ["qualified"]);
  assert.ok(routeGig(WS, nothing.id, web.id).ok);
  const cleared = unrouteGig(WS, nothing.id);
  assert.ok(cleared.ok && cleared.gig.specialistId === null, "nothing fits: no specialist, dispatch will say so");
});

test("the store's route write is a CAS on the status read", () => {
  const gig = moveTo(newGig(), ["qualified"]);
  const stale = setGigRoute(WS, gig.id, { expectedStatus: "new", specialistId: web.id, niche: "web development" });
  assert.deepEqual(stale, { ok: false, reason: "stale" });
  const row = getGig(WS, gig.id)!;
  assert.equal(row.specialistId, null);
  assert.equal(row.niche, null);
  assert.deepEqual(setGigRoute("ws-someone-else", gig.id, { expectedStatus: "qualified", specialistId: null, niche: null }), { ok: false, reason: "not_found" });
  const ok = setGigRoute(WS, gig.id, { expectedStatus: "qualified", specialistId: web.id, niche: "  web development  " });
  assert.ok(ok.ok && ok.gig.niche === "web development" && ok.gig.status === "qualified");
});
