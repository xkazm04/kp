// The doors the /me flow ("The Sieve") added, on an isolated DB in open auth mode:
//   GET /api/jobseeker/postings?status=all   every row, decided and gone included
//   the summary's new projections            as-if score, gate sentences, skills with provenance
//   GET /api/jobseeker/postings/[id]         the Weigh step's read, workspace-bound
//   PUT /api/jobseeker/profile + preferencesReplace   removing the last place empties it
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { setJobseekerPostingStatus, setPostingBlocked, setPostingMatch, setPostingStructure, upsertPosting } from "../../../_lib/db/jobseeker-postings.ts";
import { upsertJobseekerProfile } from "../../../_lib/db/jobseeker-profiles.ts";
import { EMPTY_PREFERENCES, type JobseekerPostingSummary, type RawPosting } from "../../../_lib/jobseeker/types.ts";
import { GET as LIST } from "./route.ts";
import { GET as ONE } from "./[id]/route.ts";
import { PUT as PUT_PROFILE } from "../profile/route.ts";

after(() => cleanupUnitDb());

let seq = 0;
function raw(overrides: Partial<RawPosting> = {}): RawPosting {
  seq += 1;
  return {
    externalKey: `ext-${seq}`,
    url: `https://jobs.example/${seq}`,
    title: `Posting ${seq}`,
    company: "Example",
    location: "Brno",
    country: "cz",
    workMode: "hybrid",
    postedAt: null,
    salaryText: null,
    salary: null,
    bodyText: `We are hiring for role ${seq}.`,
    jsonld: null,
    lang: "en",
    ...overrides,
  };
}

const T0 = "2026-09-25T08:00:00.000Z";
const SRC = "src-a";
const V = { version: "jobseeker-match-v2", matchedAt: T0 };

const scored = upsertPosting(SRC, raw(), T0).id;
setPostingStructure(scored, { id: "j1" }, "deterministic");
setPostingMatch(
  scored,
  {
    total: 77,
    fitTier: "strong",
    matchedSkills: ["Java", "Kafka"],
    matchedSkillProvenance: { Java: "professional", Kafka: "self_declared" },
    missingSkills: ["Git"],
    isEntryEligible: false,
    graduateFriendliness: 0.15,
    confidence: { low: 73, high: 81, level: "tight" },
  },
  { total: 77, fitTier: "strong", ...V }
);

const gated = upsertPosting(SRC, raw(), T0).id;
setPostingStructure(gated, { id: "j2" }, "deterministic");
setPostingBlocked(gated, { blocked: { koKeys: ["work_mode", "vibes"], koDetails: ["work mode onsite not preferred", "?"] }, asIf: { total: 64, matchedSkills: ["Java"] } }, V);

const dismissed = upsertPosting(SRC, raw(), T0).id;
setPostingStructure(dismissed, { id: "j3" }, "deterministic");
setPostingMatch(dismissed, { total: 40, fitTier: "partial" }, { total: 40, fitTier: "partial", ...V });
setJobseekerPostingStatus(dismissed, "dismissed", { reason: "salary", note: null });

type Page = { rows: JobseekerPostingSummary[] };
const list = async (q: string) => (await (await LIST(new Request(`http://localhost/api/jobseeker/postings${q}`))).json()) as Page;

test("status=all returns decided rows the live feed hides", async () => {
  const live = await list("");
  assert.ok(!live.rows.some((r) => r.id === dismissed), "the live feed hides a dismissed row");
  const all = await list("?status=all");
  assert.deepEqual(new Set(all.rows.map((r) => r.id)), new Set([scored, gated, dismissed]));
});

test("a scored row carries its skills with provenance; a filtered one carries its as-if score and ONLY known gates' sentences", async () => {
  const rows = (await list("?status=all")).rows;
  const s = rows.find((r) => r.id === scored)!;
  assert.deepEqual(s.matchedSkills, [
    { skill: "Java", provenance: "professional" },
    { skill: "Kafka", provenance: "self_declared" },
  ]);
  assert.deepEqual(s.missingSkills, ["Git"]);
  assert.equal(s.asIfTotal, null);
  const g = rows.find((r) => r.id === gated)!;
  assert.equal(g.matchTotal, null, "a filtered row is never ranked");
  assert.equal(g.asIfTotal, 64);
  assert.deepEqual(g.blockedBy, ["work_mode"]);
  assert.deepEqual(g.blockedDetails, ["work mode onsite not preferred"], "the unknown gate's sentence is dropped with its key");
  assert.deepEqual(g.matchedSkills, [], "the as-if skills are not the posting's skills");
});

test("GET /postings/[id] answers the detail projection, and 404 for an unknown id", async () => {
  const res = await ONE(new Request(`http://localhost/api/jobseeker/postings/${scored}`), { params: Promise.resolve({ id: scored }) });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { view: { id: string; match: { matchedSkillProvenance: Record<string, string>; entryEligible: boolean | null; graduateFriendliness: number | null } | null; bodyText: string }; fit: unknown };
  assert.equal(body.view.id, scored);
  assert.deepEqual(body.view.match?.matchedSkillProvenance, { Java: "professional", Kafka: "self_declared" });
  assert.equal(body.view.match?.entryEligible, false);
  assert.equal(body.view.match?.graduateFriendliness, 0.15);
  assert.equal(body.fit, null);
  assert.ok(!("jsonld" in body.view), "the raw JSON-LD stays on the server");
  const missing = await ONE(new Request("http://localhost/api/jobseeker/postings/nope"), { params: Promise.resolve({ id: "nope" }) });
  assert.equal(missing.status, 404);
  assert.equal(((await missing.json()) as { code?: string }).code, "POSTING_NOT_FOUND");
});

test("preferencesReplace lets the direct-edit cards empty a list the merge would keep", async () => {
  upsertJobseekerProfile({ userId: null, profile: { displayName: "Test" }, preferences: { ...EMPTY_PREFERENCES, locations: ["Brno"], countries: ["cz"] }, cvSourceText: null });
  const put = (body: unknown) => PUT_PROFILE(new Request("http://localhost/api/jobseeker/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const merged = (await (await put({ preferences: { locations: [] } })).json()) as { preferences: { locations: string[] } };
  assert.deepEqual(merged.preferences.locations, ["Brno"], "a conversation turn that names no place keeps the places");
  const replaced = (await (await put({ preferences: { locations: [] }, preferencesReplace: true })).json()) as { preferences: { locations: string[]; countries: string[] } };
  assert.deepEqual(replaced.preferences.locations, [], "the seeker removed the last place, and it is gone");
  assert.deepEqual(replaced.preferences.countries, ["cz"], "a field the patch did not name is untouched");
});
