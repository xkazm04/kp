// Gig matchmaking (match.ts): pure ranking - arena filter, niche overlap with synonyms,
// readiness, the record tie-breaker, ordering stability, and the niche suggestion.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GigSpecialistSpec } from "./types.ts";
import {
  canRouteGig,
  GIG_ROUTABLE_STATUSES,
  MATCH_WEIGHTS,
  pickGigMatch,
  rankSpecialistsForGig,
  suggestNicheForGig,
  type GigMatchCandidate,
  type GigMatchGig,
} from "./match.ts";

function spec(arena: GigSpecialistSpec["arena"], niche: string): GigSpecialistSpec {
  return {
    arena,
    niche,
    taxonomyFamily: "general_professional",
    recipes: [],
    exemplars: [],
    connectors: [],
    budgetUsdPerAttempt: 3,
    promptVersion: "gig-specialist.v3",
  };
}

function cand(
  id: string,
  niche: string,
  over: { arena?: GigSpecialistSpec["arena"]; hireStatus?: string | null; createdAt?: string; record?: GigMatchCandidate["record"] } = {}
): GigMatchCandidate {
  return {
    specialist: { id, spec: spec(over.arena ?? "freelance", niche), createdAt: over.createdAt ?? `2026-09-25T10:00:0${id.length % 10}.000Z` },
    hireStatus: over.hireStatus === undefined ? "active" : over.hireStatus,
    record: over.record ?? null,
  };
}

function gig(over: Partial<GigMatchGig> = {}): GigMatchGig {
  return { arena: "freelance", title: "A listing", tags: [], niche: null, brief: null, ...over };
}

// The two real dry-run gigs, as the store holds them (2026-09-25).
const TYPING_TEST = gig({
  title: "Online Typing Test Development",
  tags: ["PHP", "JavaScript", "Website Design", "CSS", "HTML", "Web Development", "Backend Development", "Frontend Development"],
  brief: {
    category: "Web development · Typing test tool",
    title: "Web development · Build an online typing test that scores job applicants on speed (WPM) and accuracy using predefined paragraphs",
  },
});
const FEASIBILITY = gig({
  title: "Feasibility Assessment for AI Business Agents",
  tags: ["AI Consulting", "AI Chatbot Development", "AI Chatbot", "AI Model Development", "AI Development", "AI Agents", "AI Integration", "AI Automation", "AI Strategy", "AI Workflow Automation"],
  brief: {
    category: "AI consulting · Multi-agent feasibility study",
    title: "AI consulting · Feasibility report on a Microsoft-stack multi-agent business system (sales and outreach agents first, 6-week phase 1)",
  },
});
const WEB = cand("gspec-web", "web development", { createdAt: "2026-09-25T11:41:32.182Z" });
const AI = cand("gspec-ai", "AI consulting and technical reports", { createdAt: "2026-09-25T11:41:32.189Z" });

test("the dry-run gigs go to the specialist whose niche they name, not to the oldest", () => {
  const web = rankSpecialistsForGig(TYPING_TEST, [WEB, AI]);
  assert.deepEqual(web.map((m) => m.specialistId), ["gspec-web", "gspec-ai"]);
  assert.equal(pickGigMatch(web)?.specialistId, "gspec-web");
  assert.equal(web[1].score, 0, "nothing in the typing-test gig names AI consulting");
  assert.deepEqual(web[1].reasons, [{ code: "no_overlap", evidence: null }]);

  const ai = rankSpecialistsForGig(FEASIBILITY, [WEB, AI]);
  assert.equal(ai[0].specialistId, "gspec-ai", "the older web specialist no longer takes it");
  assert.equal(pickGigMatch(ai)?.specialistId, "gspec-ai");
  assert.ok(ai[0].score > ai[1].score + 30, `a clear margin: ${ai[0].score} vs ${ai[1].score}`);
  assert.deepEqual(
    ai[0].reasons.map((r) => r.code),
    ["category_terms", "title_terms"],
    "each matched word is credited once, in its strongest field"
  );
  assert.equal(ai[0].reasons[0].evidence, "ai, consulting");
  assert.equal(ai[0].reasons[1].evidence, "reports");
});

test("arena must match: another arena's specialist is not a candidate at all", () => {
  const ranked = rankSpecialistsForGig(TYPING_TEST, [cand("gspec-oss", "web development", { arena: "oss_bounty" }), WEB]);
  assert.deepEqual(ranked.map((m) => m.specialistId), ["gspec-web"]);
});

test("synonyms: frontend / website / sheets / copy / llm meet their area's other words", () => {
  const pairs: [string, GigMatchGig][] = [
    ["frontend", gig({ title: "Fix our website header" })],
    ["data analysis", gig({ tags: ["Excel", "Google Sheets"] })],
    ["copywriting", gig({ brief: { category: "Content writing · Blog posts", title: "" } })],
    ["LLM agents", gig({ title: "Automation for our support inbox" })],
  ];
  for (const [niche, g] of pairs) {
    const [m] = rankSpecialistsForGig(g, [cand("gspec-x", niche)]);
    assert.ok(m.score > 0, `${niche} should fit "${g.title} ${g.tags.join(",")} ${g.brief?.category ?? ""}"`);
  }
  // ...and do not leak across areas.
  const [m] = rankSpecialistsForGig(gig({ tags: ["Excel"] }), [cand("gspec-x", "frontend")]);
  assert.equal(m.score, 0);
});

test("normalization: case, accents, plurals, -ing and stopwords do not change the fit", () => {
  const a = rankSpecialistsForGig(gig({ tags: ["Reports"] }), [cand("gspec-x", "report")])[0];
  const b = rankSpecialistsForGig(gig({ tags: ["report"] }), [cand("gspec-x", "The Reports")])[0];
  const c = rankSpecialistsForGig(gig({ title: "Consulting for a café" }), [cand("gspec-x", "consult")])[0];
  assert.ok(a.score > 0 && a.score === b.score);
  assert.ok(c.score > 0);
});

test("field weights: the brief category outranks tags, tags outrank the title", () => {
  const s = [cand("gspec-x", "dashboard")];
  const cat = rankSpecialistsForGig(gig({ brief: { category: "Dashboard", title: "" } }), s)[0].score;
  const tag = rankSpecialistsForGig(gig({ tags: ["Dashboard"] }), s)[0].score;
  const title = rankSpecialistsForGig(gig({ title: "A dashboard" }), s)[0].score;
  assert.ok(cat > tag && tag > title, `${cat} > ${tag} > ${title}`);
  assert.ok(cat <= MATCH_WEIGHTS.nicheMax);
});

test("generic words count for little: 'development' alone does not make a web specialist fit an AI gig", () => {
  const [ai, web] = rankSpecialistsForGig(FEASIBILITY, [WEB, AI]);
  assert.equal(ai.specialistId, "gspec-ai");
  assert.ok(web.score > 0 && web.score < 25, `the shared generic word keeps it low: ${web.score}`);
});

test("a no-brief gig matches on title and tags alone, and a gig with nothing to read fits nobody", () => {
  const [m] = rankSpecialistsForGig(gig({ title: "Landing page for a bakery" }), [WEB]);
  assert.ok(m.score > 0);
  assert.deepEqual(m.reasons.map((r) => r.code), ["title_terms"]);
  const [none] = rankSpecialistsForGig(gig({ title: "Help needed" }), [WEB]);
  assert.equal(none.score, 0);
  assert.equal(pickGigMatch([none]), null);
});

test("a generalist niche takes anything, ranked below a real fit", () => {
  const ranked = rankSpecialistsForGig(TYPING_TEST, [cand("gspec-gen", "general"), WEB]);
  assert.deepEqual(ranked.map((m) => m.specialistId), ["gspec-web", "gspec-gen"]);
  assert.equal(ranked[1].score, MATCH_WEIGHTS.generalist);
  assert.equal(ranked[1].reasons[0].code, "generalist");
});

test("readiness: only onboarding/active hires are ready; pickGigMatch skips the rest", () => {
  const pending = cand("gspec-p", "web development", { hireStatus: "pending_approval", createdAt: "2026-09-25T09:00:00.000Z" });
  const gone = cand("gspec-g", "web development", { hireStatus: null, createdAt: "2026-09-25T09:30:00.000Z" });
  const onboarding = cand("gspec-o", "web development", { hireStatus: "onboarding", createdAt: "2026-09-25T12:00:00.000Z" });
  const ranked = rankSpecialistsForGig(TYPING_TEST, [pending, gone, onboarding]);
  assert.equal(ranked[0].specialistId, "gspec-o", "on equal scores the ready one leads");
  assert.deepEqual(ranked.map((m) => m.ready), [true, false, false]);
  assert.deepEqual(ranked.find((m) => m.specialistId === "gspec-p")?.reasons.at(-1), { code: "hire_not_ready", evidence: "pending_approval" });
  assert.deepEqual(ranked.find((m) => m.specialistId === "gspec-g")?.reasons.at(-1), { code: "no_hire", evidence: null });
  assert.equal(pickGigMatch(ranked)?.specialistId, "gspec-o");
  assert.equal(pickGigMatch(rankSpecialistsForGig(TYPING_TEST, [pending, gone])), null, "no ready candidate, no match");
});

test("the record breaks ties, labelled, damped under the small-sample size, and never matches alone", () => {
  const a = cand("gspec-a", "web development", { createdAt: "2026-09-25T09:00:00.000Z" });
  const b = cand("gspec-b", "web development", { createdAt: "2026-09-25T10:00:00.000Z", record: { accepted: 8, resolved: 10 } });
  const ranked = rankSpecialistsForGig(TYPING_TEST, [a, b]);
  assert.equal(ranked[0].specialistId, "gspec-b", "the proven one beats the older one");
  assert.equal(ranked[0].score - ranked[1].score, 8);
  assert.deepEqual(ranked[0].reasons.at(-1), { code: "record", evidence: "8/10" });
  const tiny = rankSpecialistsForGig(TYPING_TEST, [cand("gspec-c", "web development", { record: { accepted: 1, resolved: 1 } })])[0];
  const plain = rankSpecialistsForGig(TYPING_TEST, [cand("gspec-c", "web development")])[0];
  assert.equal(tiny.score - plain.score, 1, "1/1 is one point, not ten");
  const off = rankSpecialistsForGig(TYPING_TEST, [cand("gspec-d", "AI consulting", { record: { accepted: 10, resolved: 10 } })])[0];
  assert.equal(off.score, 0, "a record adds nothing to a specialist that does not fit");
});

test("a routed gig: its niche equal to the specialist's scores 100 and stays first", () => {
  const routed = rankSpecialistsForGig({ ...FEASIBILITY, niche: "  web DEVELOPMENT " }, [AI, WEB]);
  assert.equal(routed[0].specialistId, "gspec-web");
  assert.equal(routed[0].score, 100);
  assert.deepEqual(routed[0].reasons[0], { code: "routed", evidence: "web development" });
});

test("ordering is stable: score, ready, the incumbent, the oldest, then id", () => {
  const x = cand("gspec-x", "web development", { createdAt: "2026-09-25T10:00:00.000Z" });
  const y = cand("gspec-y", "web development", { createdAt: "2026-09-25T09:00:00.000Z" });
  const z = cand("gspec-z", "web development", { createdAt: "2026-09-25T09:00:00.000Z" });
  assert.deepEqual(rankSpecialistsForGig(TYPING_TEST, [x, z, y]).map((m) => m.specialistId), ["gspec-y", "gspec-z", "gspec-x"]);
  assert.deepEqual(rankSpecialistsForGig(TYPING_TEST, [y, x, z]).map((m) => m.specialistId), ["gspec-y", "gspec-z", "gspec-x"], "input order does not matter");
  assert.deepEqual(
    rankSpecialistsForGig({ ...TYPING_TEST, specialistId: "gspec-x" }, [x, y, z]).map((m) => m.specialistId),
    ["gspec-x", "gspec-y", "gspec-z"],
    "on a tie the gig's current specialist keeps it"
  );
});

test("suggestNicheForGig: the brief category's head, else the first tag, else null", () => {
  assert.equal(suggestNicheForGig(TYPING_TEST), "Web development");
  assert.equal(suggestNicheForGig(FEASIBILITY), "AI consulting");
  assert.equal(suggestNicheForGig({ tags: ["  Data  Entry "], brief: null }), "Data Entry");
  assert.equal(suggestNicheForGig({ tags: [], brief: null }), null);
  assert.equal(suggestNicheForGig({ tags: [], brief: { category: " · " } }), null);
});

test("canRouteGig: new | qualified | drafted | in_review and not suspect", () => {
  for (const s of GIG_ROUTABLE_STATUSES) assert.ok(canRouteGig({ status: s, suspectReasons: [] }), s);
  for (const s of ["suspect", "dispatched", "sent", "declined", "accepted"] as const) assert.ok(!canRouteGig({ status: s, suspectReasons: [] }), s);
  assert.ok(!canRouteGig({ status: "qualified", suspectReasons: ["hidden_instructions"] }), "a gig carrying honeypot reasons is not routed");
});
