// Gig qualification (qualify.ts): the pure arithmetic, then the store-backed
// qualifyAndMatch on an isolated throwaway DB. unit-db.ts must be the first project import.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { gigPipelineDecline, type Gig, type GigSpecialist, type GigSpecialistSpec } from "./types.ts";
import {
  DEADLINE_COMFORT_DAYS,
  QUALIFY_THRESHOLD,
  QUALIFY_WEIGHTS,
  deadlineHeadroomDays,
  NON_DIGITAL_TAGS,
  nonDigitalWork,
  qualifies,
  qualifyAndMatch,
  qualifyGig,
  qualifyGigHook,
  rankGigSpecialists,
} from "./qualify.ts";
import { pickGigMatch } from "./match.ts";
import { createManualGig, getGig, setGigRoute, upsertGigFromRaw } from "../db/gigs.ts";
import { createGigSpecialist } from "../db/gigs-specialists.ts";
import { createHiredAgent, updateHiredAgentStatus } from "../db/agents.ts";

after(() => cleanupUnitDb());

const NOW = new Date("2026-09-24T12:00:00.000Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

function spec(arena: GigSpecialistSpec["arena"], niche = "web"): GigSpecialistSpec {
  return {
    arena,
    niche,
    taxonomyFamily: "software_engineering",
    recipes: [],
    exemplars: [],
    connectors: [],
    budgetUsdPerAttempt: 5,
    promptVersion: "gig-specialist.v1",
  };
}

function fakeSpecialist(arena: GigSpecialistSpec["arena"]): GigSpecialist {
  return { id: "gspec-1", hiredAgentId: "agent-1", gigId: null, name: "S", spec: spec(arena), registry: "unavailable", createdAt: "", updatedAt: "" };
}

type QGig = Pick<Gig, "arena" | "reward" | "deadlineAt" | "status" | "suspectReasons">;
function g(over: Partial<QGig> = {}): QGig {
  return { arena: "security", reward: { amount: 500, currency: "USD", text: "$500" }, deadlineAt: inDays(30), status: "new", suspectReasons: [], ...over };
}

test("the weights are the documented arithmetic and a perfect gig scores 100", () => {
  const q = qualifyGig(g(), { specialist: fakeSpecialist("security"), now: NOW });
  assert.equal(q.score, QUALIFY_WEIGHTS.arenaFit + QUALIFY_WEIGHTS.rewardKnown + QUALIFY_WEIGHTS.deadlineFull + QUALIFY_WEIGHTS.specialistAvailable);
  assert.equal(q.score, 100);
  assert.deepEqual(q.factors, { arenaFit: true, rewardKnown: true, deadlineHeadroomDays: 30, specialistAvailable: true, suspect: false });
  assert.equal(q.source, "deterministic");
  assert.equal(q.note, null);
  assert.equal(q.fallbackReason, null);
  assert.ok(qualifies(q));
});

test("no deadline is neutral, not a penalty and not full marks", () => {
  const q = qualifyGig(g({ deadlineAt: null }), { specialist: fakeSpecialist("security"), now: NOW });
  assert.equal(q.factors.deadlineHeadroomDays, null);
  assert.equal(q.score, 100 - QUALIFY_WEIGHTS.deadlineFull + QUALIFY_WEIGHTS.deadlineNeutral);
});

test("under two days of headroom is a heavy penalty that drops a good gig below the bar", () => {
  const q = qualifyGig(g({ deadlineAt: inDays(1) }), { specialist: fakeSpecialist("security"), now: NOW });
  assert.equal(q.factors.deadlineHeadroomDays, 1);
  assert.equal(q.score, 40 + 20 + 20 + QUALIFY_WEIGHTS.deadlineRushPenalty);
  assert.ok(q.score < QUALIFY_THRESHOLD);
  assert.equal(qualifies(q), false);
});

test("headroom between 2 and 7 days scales between neutral and full", () => {
  const mid = qualifyGig(g({ deadlineAt: inDays(4.5) }), { specialist: fakeSpecialist("security"), now: NOW });
  assert.equal(mid.score, 80 + 15);
  const edge = qualifyGig(g({ deadlineAt: inDays(DEADLINE_COMFORT_DAYS) }), { specialist: fakeSpecialist("security"), now: NOW });
  assert.equal(edge.score, 100);
});

test("a deadline already passed scores 0", () => {
  const q = qualifyGig(g({ deadlineAt: inDays(-1) }), { specialist: fakeSpecialist("security"), now: NOW });
  assert.equal(q.score, 0);
  assert.equal(qualifies(q), false);
});

test("suspect (status or recorded reasons) scores 0 and never qualifies", () => {
  for (const over of [{ status: "suspect" as const }, { suspectReasons: ["credential_request" as const] }]) {
    const q = qualifyGig(g(over), { specialist: fakeSpecialist("security"), now: NOW });
    assert.equal(q.score, 0);
    assert.equal(q.factors.suspect, true);
    assert.equal(qualifies(q), false);
  }
  // Even a forged verdict with a high score does not qualify while suspect.
  assert.equal(qualifies({ ...qualifyGig(g(), { specialist: null, now: NOW }), score: 99, factors: { ...qualifyGig(g(), { specialist: null, now: NOW }).factors, suspect: true } }), false);
});

test("no specialist caps the score below the bar; a specialist from another arena is not a fit", () => {
  const none = qualifyGig(g(), { specialist: null, now: NOW });
  assert.equal(none.score, QUALIFY_WEIGHTS.rewardKnown + QUALIFY_WEIGHTS.deadlineFull);
  assert.equal(qualifies(none), false);
  const wrong = qualifyGig(g(), { specialist: fakeSpecialist("freelance"), now: NOW });
  assert.equal(wrong.factors.arenaFit, false);
  assert.equal(wrong.factors.specialistAvailable, true);
});

test("a paired install: every gig has its persona available and fits its arena - the score a matched niche specialist earned", () => {
  const paired = qualifyGig(g(), { specialist: null, now: NOW, paired: true });
  assert.deepEqual(paired.factors, { arenaFit: true, rewardKnown: true, deadlineHeadroomDays: 30, specialistAvailable: true, suspect: false });
  assert.equal(paired.score, qualifyGig(g(), { specialist: fakeSpecialist("security"), now: NOW }).score, "identical to the matched case");
  assert.ok(qualifies(paired));
  assert.equal(qualifyGig(g({ suspectReasons: ["credential_request"] }), { specialist: null, now: NOW, paired: true }).score, 0, "suspect still scores 0");
  assert.equal(qualifyGig(g(), { specialist: null, now: NOW, paired: false }).factors.specialistAvailable, false);
});

test("a reward without a parseable amount is not a known reward", () => {
  const q = qualifyGig(g({ reward: { amount: null, currency: null, text: "competitive" } }), { specialist: fakeSpecialist("security"), now: NOW });
  assert.equal(q.factors.rewardKnown, false);
  assert.equal(qualifyGig(g({ reward: null }), { specialist: fakeSpecialist("security"), now: NOW }).factors.rewardKnown, false);
});

test("deadlineHeadroomDays: null for absent or unparseable, one decimal otherwise", () => {
  assert.equal(deadlineHeadroomDays(null, NOW), null);
  assert.equal(deadlineHeadroomDays("not a date", NOW), null);
  assert.equal(deadlineHeadroomDays(inDays(2.345), NOW), 2.3);
});

// ---------------------------------------------------------------------------
// Store-backed
// ---------------------------------------------------------------------------

const WS = "ws-gig-qualify";
let seq = 0;

// Tagged "web" by default so the default specialist niche ("web") fits it: the matcher
// (match.ts) no longer hands a gig to an arena specialist that nothing in it names.
function newGig(arena: Gig["arena"] = "security", over: { deadlineAt?: string | null; suspect?: boolean; tags?: string[]; title?: string; body?: string } = {}): Gig {
  seq += 1;
  return upsertGigFromRaw(WS, {
    sourceId: "gsrc-q",
    arena,
    raw: {
      externalKey: `q-${seq}`,
      url: `https://example.test/q/${seq}`,
      title: over.title ?? `Qualify ${seq}`,
      org: null,
      reward: { amount: 300, currency: "USD", text: "$300" },
      deadlineAt: over.deadlineAt === undefined ? inDays(20) : over.deadlineAt,
      postedAt: null,
      bodyText: over.body ?? "Find the bug.",
      bodyHtml: null,
      tags: over.tags ?? ["web"],
    },
    suspectReasons: over.suspect ? ["hidden_instructions"] : [],
  }).gig;
}

function hireSpecialist(arena: Gig["arena"], status: "pending_approval" | "active" | "failed" = "active", niche = "web"): GigSpecialist {
  const agent = createHiredAgent({ jobTitle: "Gig specialist - test", spec: {} }, WS);
  updateHiredAgentStatus(agent.id, status, { personaId: status === "active" ? `p-${agent.id}` : null }, WS);
  return createGigSpecialist(WS, { hiredAgentId: agent.id, name: "Spec", spec: spec(arena, niche), registry: "unavailable" });
}

test("qualifyAndMatch: no specialist -> verdict recorded, gig stays new", () => {
  const gig = newGig("competition");
  const r = qualifyAndMatch(WS, gig.id, { now: NOW });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.moved, false);
  assert.equal(r.specialistId, null);
  const stored = getGig(WS, gig.id)!;
  assert.equal(stored.status, "new");
  assert.equal(stored.qualification?.factors.specialistAvailable, false);
});

test("qualifyAndMatch: no auto-routing - a live niche specialist in the arena is NOT matched; a paired install qualifies with specialist_id null", () => {
  hireSpecialist("security");
  const gig = newGig("security");
  const unpaired = qualifyAndMatch(WS, gig.id, { now: NOW, paired: false });
  assert.ok(unpaired.ok && !unpaired.moved && unpaired.specialistId === null, "a niche specialist is no longer auto-routed");
  const r = qualifyAndMatch(WS, gig.id, { now: NOW, paired: true });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.moved, true);
  assert.equal(r.specialistId, null);
  const stored = getGig(WS, gig.id)!;
  assert.equal(stored.status, "qualified");
  assert.equal(stored.specialistId, null, "specialist_id stays null until pairing");
  assert.equal(stored.qualification?.score, 100);
});

test("qualifyAndMatch: a gig the operator routed to a ready niche specialist keeps it and counts it", () => {
  const specialist = hireSpecialist("oss_bounty", "active", "rust cli");
  const gig = newGig("oss_bounty");
  assert.ok(setGigRoute(WS, gig.id, { expectedStatus: "new", specialistId: specialist.id, niche: "rust cli" }).ok);
  const r = qualifyAndMatch(WS, gig.id, { now: NOW, paired: false });
  assert.ok(r.ok && r.moved && r.specialistId === specialist.id);
  assert.equal(getGig(WS, gig.id)!.specialistId, specialist.id, "the route survives the re-qualification");
});

test("qualifyAndMatch: a specialist whose hire failed is not a match", () => {
  hireSpecialist("oss_bounty", "failed");
  const gig = newGig("oss_bounty");
  const r = qualifyAndMatch(WS, gig.id, { now: NOW });
  assert.ok(r.ok && !r.moved && r.specialistId === null);
});

test("rankGigSpecialists (the legacy ranker routing still uses): the best-fitting READY niche specialist first; a gig persona is never ranked", () => {
  // Freelance is otherwise empty in this file. Hired oldest first.
  const web = hireSpecialist("freelance", "active", "web development");
  const pending = hireSpecialist("freelance", "pending_approval", "AI consulting and technical reports");
  const ai = hireSpecialist("freelance", "active", "AI consulting");
  const agent = createHiredAgent({ jobTitle: "Gig persona - test", spec: {} }, WS);
  updateHiredAgentStatus(agent.id, "active", { personaId: `p-${agent.id}` }, WS);
  const persona = createGigSpecialist(WS, { hiredAgentId: agent.id, name: "Persona", spec: spec("freelance", "AI consulting"), registry: "unavailable", gigId: "gig-other" });
  const gig = newGig("freelance", { title: "Feasibility report for AI agents", tags: ["AI Consulting", "AI Agents"] });
  const ranked = rankGigSpecialists(WS, gig);
  assert.equal(pickGigMatch(ranked)?.specialistId, ai.id, "the web one is older but does not fit; the pending one fits but is not ready");
  assert.ok(!ranked.some((m) => m.specialistId === persona.id), "another gig's persona is not a candidate");
  assert.ok(ranked.some((m) => m.specialistId === web.id) && ranked.some((m) => m.specialistId === pending.id));
});

test("qualifyAndMatch: an arena specialist whose niche nothing in the gig names is not a match", () => {
  const gig = newGig("freelance", { title: "Knit me a scarf", tags: ["Knitting"] });
  const r = qualifyAndMatch(WS, gig.id, { now: NOW });
  assert.ok(r.ok && !r.moved && r.specialistId === null);
  assert.equal(getGig(WS, gig.id)!.qualification?.factors.arenaFit, false);
});

test("qualifyAndMatch: a rushed deadline stays new with its low verdict", () => {
  const gig = newGig("security", { deadlineAt: inDays(1) });
  const r = qualifyAndMatch(WS, gig.id, { now: NOW });
  assert.ok(r.ok && !r.moved);
  assert.equal(getGig(WS, gig.id)!.status, "new");
});

test("qualifyAndMatch: a suspect gig gets a zero verdict and no move", () => {
  const gig = newGig("security", { suspect: true });
  assert.equal(gig.status, "suspect");
  const r = qualifyAndMatch(WS, gig.id, { now: NOW });
  assert.ok(r.ok && !r.moved);
  const stored = getGig(WS, gig.id)!;
  assert.equal(stored.status, "suspect");
  assert.equal(stored.qualification?.score, 0);
});

test("qualifyAndMatch: not_found across workspaces, not_qualifiable past new", () => {
  const gig = newGig("security");
  assert.deepEqual(qualifyAndMatch("ws-other", gig.id), { ok: false, reason: "not_found" });
  assert.ok(qualifyAndMatch(WS, gig.id, { now: NOW, paired: true }).ok);
  assert.equal(getGig(WS, gig.id)!.status, "qualified");
  assert.deepEqual(qualifyAndMatch(WS, gig.id), { ok: false, reason: "not_qualifiable" });
});

test("the hook shape the scan calls works on a manual gig too", () => {
  const { gig } = createManualGig(WS, {
    arena: "freelance",
    url: "https://example.test/brief",
    title: "Brief",
    org: null,
    reward: null,
    deadlineAt: null,
    bodyText: "Write me a landing page.",
    tags: [],
    suspectReasons: [],
  });
  const r = qualifyGigHook(WS, gig.id);
  assert.ok(r.ok);
  // The scan hands the row itself (scan.ts GigQualifyHook); the id is what is used.
  const row = newGig("competition");
  const stale: Gig = { ...row, status: "qualified" };
  const viaRow = qualifyGigHook(WS, stale);
  assert.ok(viaRow.ok, "the status is re-read from the store, not taken from the row handed in");
});

// ---------------------------------------------------------------------------
// Physical work never reaches the desk (the not-digital rule)
// ---------------------------------------------------------------------------

/** The listing the operator named (freelancer.com, 2026-09-30), tags as the adapter emitted them. */
const GIFT_CARDS = {
  title: "Bulk Retail Gift Cards",
  tags: ["Data Entry", "Excel", "Sales", "Bulk Marketing", "Supplier Sourcing", "Logistics", "eBay", "Inventory Management"],
  bodyText:
    "I'm sourcing a dependable supplier who can deliver physical retail gift cards in mid-size batches. Specifically, I need between 50 and 100 cards each for Amazon, Walmart, and Target. I'll require tracking details once the shipment leaves your facility and a simple activation report confirming balances on arrival.",
};

test("nonDigitalWork: the gift-card sourcing listing is physical work, with its evidence", () => {
  const v = nonDigitalWork(GIFT_CARDS);
  assert.equal(v.hit, true);
  assert.deepEqual(v.tags, ["Supplier Sourcing", "Logistics", "eBay", "Inventory Management"]);
  assert.deepEqual(v.phrases, ["physical goods", "sourcing a supplier"]);
});

test("nonDigitalWork: digital work ABOUT logistics or inventory is never declined", () => {
  const dashboard = nonDigitalWork({
    title: "Logistics KPI dashboard",
    tags: ["Logistics", "Data Entry", "Excel", "Shipping"],
    bodyText: "Build a Power BI dashboard over our warehouse and shipment data. We ship products to 40 stores and need on-time rates per carrier.",
  });
  assert.equal(dashboard.hit, false, "one physical phrase beside a digital deliverable is a job about the goods");
  assert.deepEqual(dashboard.phrases, ["shipping goods"]);
  const spreadsheet = nonDigitalWork({
    title: "Inventory spreadsheet cleanup",
    tags: ["Inventory Management", "Excel", "Data Entry"],
    bodyText: "Clean up our inventory spreadsheet: 2,000 rows of physical stock counts with duplicates and wrong SKUs. Deliver the cleaned file.",
  });
  assert.equal(spreadsheet.hit, false);
  const shopify = nonDigitalWork({
    title: "Automate Shopify Discounted Shipping",
    tags: ["PHP", "Shopify", "API", "Shipping", "Automation"],
    bodyText: "Eliminate the extra UPS charges when an item is shipped from our factory instead of our main warehouse; the discounted label must print automatically.",
  });
  assert.equal(shopify.hit, false);
});

test("nonDigitalWork: a tag alone, or the text alone, is never enough", () => {
  assert.equal(nonDigitalWork({ title: "Order data entry", tags: ["Logistics", "Data Entry"], bodyText: "Type 300 order lines from PDFs into our sheet." }).hit, false, "a tag alone");
  assert.equal(nonDigitalWork({ ...GIFT_CARDS, tags: ["Data Entry", "Excel"] }).hit, false, "the text alone");
  assert.ok(NON_DIGITAL_TAGS.has("supplier sourcing") && !NON_DIGITAL_TAGS.has("data entry"), "the tag set is lower-cased and names no digital skill");
});

test("qualifyAndMatch: a scanned physical listing is declined with its reason and evidence; the verdict says so", () => {
  const gig = newGig("freelance", { title: GIFT_CARDS.title, tags: GIFT_CARDS.tags, body: GIFT_CARDS.bodyText });
  const r = qualifyAndMatch(WS, gig.id, { now: NOW, paired: true });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.declined, true);
  assert.equal(r.moved, false);
  const stored = getGig(WS, gig.id)!;
  assert.equal(stored.status, "declined");
  assert.equal(stored.qualification?.score, 0, "no number next to a decline");
  assert.equal(stored.qualification?.factors.notDigitalWork, true);
  assert.equal(stored.qualification?.declineReason, "not_digital_work");
  assert.equal(stored.qualification?.declinedBy, "rule");
  assert.deepEqual(stored.qualification?.declineEvidence, ["Supplier Sourcing", "Logistics", "eBay", "Inventory Management", "physical goods", "sourcing a supplier"]);
  assert.deepEqual(gigPipelineDecline(stored), {
    reason: "not_digital_work",
    by: "rule",
    evidence: ["Supplier Sourcing", "Logistics", "eBay", "Inventory Management", "physical goods", "sourcing a supplier"],
    detail: null,
  });
});

test("qualifyAndMatch: a digital listing records notDigitalWork false and qualifies as before", () => {
  const gig = newGig("freelance", { title: "Logistics KPI dashboard", tags: ["Logistics", "Excel"], body: "Build a dashboard of the goods we ship to 40 stores." });
  const r = qualifyAndMatch(WS, gig.id, { now: NOW, paired: true });
  assert.ok(r.ok && r.moved && !r.declined);
  const stored = getGig(WS, gig.id)!;
  assert.equal(stored.status, "qualified");
  assert.equal(stored.qualification?.factors.notDigitalWork, false);
  assert.equal(stored.qualification?.declineReason, undefined);
  assert.equal(gigPipelineDecline(stored), null);
});

test("qualifyAndMatch: a manual gig the operator forwarded is never auto-declined as physical", () => {
  const { gig } = createManualGig(WS, {
    arena: "freelance",
    url: "https://example.test/gift-cards",
    title: GIFT_CARDS.title,
    org: null,
    reward: { amount: 300, currency: "USD", text: "$300" },
    deadlineAt: inDays(20),
    bodyText: GIFT_CARDS.bodyText,
    tags: GIFT_CARDS.tags,
    suspectReasons: [],
  });
  const r = qualifyAndMatch(WS, gig.id, { now: NOW, paired: true });
  assert.ok(r.ok && !r.declined);
  assert.notEqual(getGig(WS, gig.id)!.status, "declined");
});
