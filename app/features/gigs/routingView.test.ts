// The Match panel's pure derivation (routingView.ts): the same ranking the qualifier uses,
// the routed / auto-matched distinction, why routing is locked, and when to offer a hire.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Gig, GigKpi, GigKpiCell } from "@/app/_lib/gigs/types.ts";
import type { SpecialistRow } from "./gigsLogic.ts";
import { routingLockOf, routingView } from "./routingView.ts";

function row(id: string, niche: string, status: string | null = "active", createdAt = "2026-09-25T10:00:00.000Z"): SpecialistRow {
  return {
    id,
    hiredAgentId: `agent-${id}`,
    name: `Spec ${niche}`,
    spec: { arena: "freelance", niche, taxonomyFamily: "general_professional", recipes: [], exemplars: [], connectors: [], budgetUsdPerAttempt: 3, promptVersion: "v" },
    registry: "unavailable",
    createdAt,
    updatedAt: createdAt,
    hire: status === null ? null : { id: `agent-${id}`, status, personaId: null, personaName: null, requestId: null, updatedAt: createdAt, lastReportAt: null },
  };
}

function gig(over: Partial<Gig> = {}): Gig {
  return {
    id: "gig-1",
    sourceId: null,
    arena: "freelance",
    externalKey: "k",
    url: "https://example.test/g",
    title: "Online typing test",
    org: null,
    reward: null,
    deadlineAt: null,
    postedAt: null,
    bodyText: "",
    tags: ["Web Development"],
    niche: null,
    status: "new",
    suspectReasons: [],
    specialistId: null,
    qualification: null,
    brief: null,
    workdir: null,
    personasProjectId: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const WEB = row("gspec-web", "web development", "active", "2026-09-25T11:00:00.000Z");
const AI = row("gspec-ai", "AI consulting", "active", "2026-09-25T09:00:00.000Z");

test("ranks with the matcher and names the current match as auto-matched or routed", () => {
  const auto = routingView(gig({ specialistId: "gspec-web" }), [AI, WEB], null);
  assert.deepEqual(auto.ranked.map((c) => c.specialist.id), ["gspec-web", "gspec-ai"], "the older AI specialist ranks below the fit");
  assert.equal(auto.current?.id, "gspec-web");
  assert.equal(auto.routed, false);
  assert.equal(auto.noFit, false);
  assert.equal(auto.lock, null);

  const routed = routingView(gig({ specialistId: "gspec-ai", niche: "AI Consulting" }), [AI, WEB], null);
  assert.equal(routed.routed, true);
  assert.equal(routed.ranked[0].specialist.id, "gspec-ai");
});

test("the KPI record rides in as the tie-breaker", () => {
  const cell = (accepted: number, resolved: number): GigKpiCell => ({ resolved, accepted, rate: accepted / resolved, pending: 0, costPerAcceptedUsd: null, costUnreported: 0, smallSample: resolved < 10 });
  const twin = row("gspec-twin", "web development", "active", "2026-09-25T12:00:00.000Z");
  const kpi: Pick<GigKpi, "bySpecialist"> = { bySpecialist: { "gspec-twin": cell(9, 10) } };
  const v = routingView(gig(), [WEB, twin], kpi);
  assert.equal(v.ranked[0].specialist.id, "gspec-twin");
  assert.equal(v.ranked[0].reasons.at(-1)?.code, "record");
});

test("noFit when nothing both scores above 0 and is ready; the suggestion comes from the brief", () => {
  const brief = { category: "Data entry · Product catalogue", title: "Data entry · Load 500 products" } as Gig["brief"];
  const v = routingView(gig({ tags: [], title: "Catalogue work", brief }), [AI], null);
  assert.equal(v.noFit, true);
  assert.equal(v.suggestedNiche, "Data entry");
  const pendingOnly = routingView(gig(), [row("gspec-p", "web development", "pending_approval")], null);
  assert.equal(pendingOnly.noFit, true, "a fitting specialist that is not ready does not count");
  assert.equal(routingView(gig(), [], null).noFit, true);
});

test("the lock says why routing is closed", () => {
  assert.equal(routingLockOf({ status: "dispatched", suspectReasons: [] }), "dispatched");
  assert.equal(routingLockOf({ status: "suspect", suspectReasons: ["hidden_instructions"] }), "suspect");
  assert.equal(routingLockOf({ status: "qualified", suspectReasons: ["hidden_instructions"] }), "suspect");
  assert.equal(routingLockOf({ status: "sent", suspectReasons: [] }), "closed");
  assert.equal(routingLockOf({ status: "in_review", suspectReasons: [] }), null);
});
