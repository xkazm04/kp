// The detail page's pure shaping. `diveOutcome` is the branch the deep-dive button
// takes, and it is pinned here because getting it wrong is invisible: the bug it
// replaced answered a red "the deep-dive could not run" to a KEYLESS install (an honest
// answer, not a failure) and a silent no-op to a template whose verdict was missing.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { JobseekerPosting } from "@/app/_lib/jobseeker/types";
import { blockedView, diveOutcome, postingDetailView, reasoningView } from "./postingView.ts";

test("diveOutcome: the door's three honest answers, and only a broken one is `failed`", () => {
  assert.equal(diveOutcome({ source: "llm", fallbackReason: null }), "llm");
  assert.equal(diveOutcome({ source: "deterministic", fallbackReason: "no_provider" }), "no_provider");
  assert.equal(diveOutcome({ source: "deterministic", fallbackReason: "template" }), "template");
  // A deterministic answer with no reason stated is still a template, never an error:
  // the page must degrade to the honest note, not to red.
  assert.equal(diveOutcome({ source: "deterministic" }), "template");
});

test("diveOutcome: an unreadable answer is `failed`, which is the ONLY red state", () => {
  assert.equal(diveOutcome(null), "failed");
  assert.equal(diveOutcome(undefined), "failed");
  assert.equal(diveOutcome({}), "failed");
  assert.equal(diveOutcome({ source: "POSTING_NOT_FOUND" }), "failed", "a refusal body is not a rationale");
});

test("reasoningView: a rationale without a verdict is nothing to show", () => {
  assert.equal(reasoningView(null), null);
  assert.equal(reasoningView({}), null, "an empty template renders the note alone, not an empty panel");
  assert.equal(reasoningView({ verdict: "   " }), null);
  assert.deepEqual(reasoningView({ verdict: "Worth applying.", strengths: ["TypeScript", 3], gaps: [], interviewProbes: ["Why us?"] }), {
    verdict: "Worth applying.",
    strengths: ["TypeScript"],
    gaps: [],
    probes: ["Why us?"],
  });
});

function posting(over: Partial<JobseekerPosting>): JobseekerPosting {
  return {
    id: "jpo-1",
    sourceId: "src",
    externalKey: "k",
    url: "https://jobs.example/1",
    title: "Python Developer",
    company: "Example",
    location: "Praha",
    country: "cz",
    workMode: "onsite",
    postedAt: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    bodyText: "We hire.",
    jsonld: null,
    contentHash: "h",
    job: { title: "Python Developer" },
    jobSource: "deterministic",
    match: null,
    matchTotal: null,
    fitTier: null,
    matchVersion: null,
    matchedAt: null,
    reasoning: null,
    status: "new",
    dismissReason: null,
    dismissNote: null,
    appliedAt: null,
    firstSeenAt: "2026-09-23T10:00:00.000Z",
    lastSeenAt: "2026-09-23T10:00:00.000Z",
    goneAt: null,
    ...over,
  };
}

const FLAG = { key: "work_mode", state: "flag", detail: "work mode onsite not preferred" } as const;
const BLOCKED_MATCH = {
  blocked: { koKeys: ["work_mode", "vibes"], koDetails: ["work mode onsite not preferred", "?"] },
  asIf: { total: 78, fitTier: "strong", eligibility: [FLAG, { key: "salary", state: "unknown", detail: "posting states no pay" }] },
};

test("postingDetailView: a filtered posting has no match view and a blocked view naming its gate and as-if score", () => {
  const view = postingDetailView(posting({ match: BLOCKED_MATCH, matchVersion: "jobseeker-match-v2", matchedAt: "2026-09-23T10:00:00.000Z" }), "EURES", null);
  assert.equal(view.match, null, "the as-if score is never rendered as the posting's score");
  assert.deepEqual(view.blocked, { koKeys: ["work_mode"], asIfTotal: 78, asIfTier: "strong", eligibility: [FLAG] });
});

test("postingDetailView: a scored posting and a never-matched one carry no blocked view", () => {
  const scored = postingDetailView(posting({ match: { total: 70, eligibility: [] }, matchTotal: 70, fitTier: "strong" }), "EURES", null);
  assert.notEqual(scored.match, null);
  assert.equal(scored.blocked, null);
  const never = postingDetailView(posting({}), "EURES", null);
  assert.equal(never.match, null);
  assert.equal(never.blocked, null, "not yet matched is a different state from filtered out");
});

test("blockedView: unreadable verdicts degrade to null, and an unreadable as-if keeps the gate", () => {
  assert.equal(blockedView(null, null), null);
  assert.equal(blockedView({ blocked: { koKeys: ["vibes"] } }, null), null, "no known gate, no verdict to show");
  assert.equal(blockedView(BLOCKED_MATCH, 70), null, "a row with a total is scored, whatever its payload says");
  assert.deepEqual(blockedView({ blocked: { koKeys: ["language"] }, asIf: "garbage" }, null), {
    koKeys: ["language"],
    asIfTotal: null,
    asIfTier: null,
    eligibility: [],
  });
});
