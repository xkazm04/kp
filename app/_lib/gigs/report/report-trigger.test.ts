// The report's stage triggers, observed through a FAKE enqueuer (no task hub, no model):
// a finished plan round asks for `planned`, an accepted plan for `accepted`, mark_sent for
// `sent`, a verdict for `closed`, and a withdraw closes only a gig that already has a report.
// Also: requestGigReport is fire-and-forget (a throwing or rejecting enqueuer never reaches
// the caller), and the boot list installs NO real enqueuer inside a node:test process.
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { cleanupUnitDb } from "../../testing/unit-db.ts";
import { test, after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WORKSPACE_ID } from "../../db/workspaces.ts";
import { createManualGig, setGigBrief, setGigReport } from "../../db/gigs.ts";
import { createGigPlanRound, setGigPlanResult } from "../../db/gigs-plans.ts";
import { registerLateBoundImplementations } from "../../late-bound-boot.ts";
import { REPORT_FIXTURE_BRIEF } from "../__fixtures__/report-facts.ts";
import { fixtureDraftedGig, fixtureReview, fixtureSentGig, fixtureSpecialist } from "../__fixtures__/sent-gig.ts";
import { runGigPlans } from "../plans.ts";
import { recordGigOutcome } from "../outcome.ts";
import { applyGigReview } from "../review.ts";
import { planSeatsFor } from "../plan-seats.ts";
import type { GigReportStage } from "../types.ts";
import { registerGigReportEnqueuer, requestGigReport } from "./trigger.ts";
import { POST as ACCEPT } from "../../../api/gigs/[id]/plans/[planId]/accept/route.ts";
import { PATCH as PATCH_GIG } from "../../../api/gigs/[id]/route.ts";

const WS = DEFAULT_WORKSPACE_ID;
const asked: { ws: string; gigId: string; stage: GigReportStage }[] = [];

before(() => {
  process.env.KP_TRUSTED_PROXY = "1";
});
beforeEach(() => {
  asked.length = 0;
  registerGigReportEnqueuer((ws, gigId, stage) => {
    asked.push({ ws, gigId, stage });
  });
});
after(() => {
  registerGigReportEnqueuer(null);
  delete process.env.KP_TRUSTED_PROXY;
  cleanupUnitDb();
});

let ip = 0;
function req(method: string, body?: unknown): Request {
  ip += 1;
  return new Request("http://localhost/api/gigs/x", {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${ip}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let seq = 0;
function briefedGig(): string {
  seq += 1;
  const { gig } = createManualGig(WS, {
    arena: "freelance",
    url: `https://example.test/trigger/${seq}`,
    title: `Trigger gig ${seq}`,
    bodyText: `Body ${seq}`,
    org: null,
    reward: null,
    deadlineAt: null,
    tags: [],
    suspectReasons: [],
  });
  setGigBrief(WS, gig.id, { ...REPORT_FIXTURE_BRIEF, difficulty: "moderate", createdAt: new Date().toISOString() });
  return gig.id;
}

const PLAN = {
  summary: "Do it in four steps.",
  steps: [1, 2, 3, 4].map((n) => ({ title: `Step ${n}`, doneWhen: `Result ${n} exists.` })),
  decisions: [],
  risks: [],
  effortHours: null,
  questions: [],
};

test("the boot list installs no real enqueuer in a node:test process", () => {
  registerLateBoundImplementations();
  assert.equal(requestGigReport(WS, "g", "researched"), false);
});

test("requestGigReport is fire-and-forget: a throwing or rejecting enqueuer never reaches the caller", async () => {
  registerGigReportEnqueuer(() => {
    throw new Error("boom");
  });
  assert.equal(requestGigReport(WS, "g", "planned"), true);
  registerGigReportEnqueuer(async () => {
    throw new Error("later");
  });
  assert.equal(requestGigReport(WS, "g", "planned"), true);
  await new Promise((r) => setTimeout(r, 10));
  registerGigReportEnqueuer(null);
  assert.equal(requestGigReport(WS, "g", "planned"), false);
});

test("a finished plan round asks for the planned report", async () => {
  const id = briefedGig();
  await runGigPlans(WS, [id], {
    deps: { seats: planSeatsFor("moderate"), runCli: async () => ({ result: PLAN, source: "llm", fallbackReason: null, costUsd: 0.1 }), log: () => {} },
  });
  assert.deepEqual(asked, [{ ws: WS, gigId: id, stage: "planned" }]);
});

test("accepting a plan asks for the accepted report", async () => {
  const id = briefedGig();
  const rows = createGigPlanRound(WS, id, [{ seat: "sonnet", model: "claude-sonnet-5-5", effort: "high" }])!;
  setGigPlanResult(WS, rows[0].id, { plan: PLAN, fallbackReason: null, costUsd: 0.1, durationMs: 1 });
  const res = await ACCEPT(req("POST", { note: "go" }), { params: Promise.resolve({ id, planId: rows[0].id }) });
  assert.equal(res.status, 200);
  assert.deepEqual(asked, [{ ws: WS, gigId: id, stage: "accepted" }]);
});

test("mark_sent asks for the sent report; a verdict asks for the closed one", async () => {
  const specialist = fixtureSpecialist(WS, "oss_bounty");
  const { gig, attempt } = fixtureDraftedGig(WS, specialist);
  const approved = await applyGigReview(WS, attempt.id, "approve", fixtureReview({ disclosure: true }));
  assert.ok(approved.ok);
  assert.deepEqual(asked, [], "approve is not a stage move");
  const sent = await applyGigReview(WS, attempt.id, "mark_sent", fixtureReview({ disclosure: true }));
  assert.ok(sent.ok);
  assert.deepEqual(asked, [{ ws: WS, gigId: gig.id, stage: "sent" }]);

  asked.length = 0;
  const { gig: other } = fixtureSentGig(WS, specialist);
  const out = recordGigOutcome(WS, { gigId: other.id, attemptId: null, verdict: "accepted", amount: 300, currency: "USD", feedbackText: null, source: "manual" });
  assert.ok(out.ok);
  assert.deepEqual(asked, [{ ws: WS, gigId: other.id, stage: "closed" }]);
});

test("a withdraw closes the report only of a gig that already has one", async () => {
  const bare = briefedGig();
  assert.equal((await PATCH_GIG(req("PATCH", { action: "withdraw" }), { params: Promise.resolve({ id: bare }) })).status, 200);
  assert.deepEqual(asked, []);

  const reported = briefedGig();
  setGigReport(WS, reported, { path: "/nowhere.html", stage: "researched", status: "ready", source: "deterministic", model: null, fallbackReason: "no_provider", costUsd: null, generatedAt: new Date().toISOString() });
  assert.equal((await PATCH_GIG(req("PATCH", { action: "withdraw" }), { params: Promise.resolve({ id: reported }) })).status, 200);
  assert.deepEqual(asked, [{ ws: WS, gigId: reported, stage: "closed" }]);
});
