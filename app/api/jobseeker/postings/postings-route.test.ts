// The postings doors on an isolated DB, in open auth mode (unit-db.ts scrubs the
// password): the feed's filters and its keyset cursor round-trip, the seeker's status
// move with the dismiss-reason rule, and the two 4xx answers that must come BEFORE any
// spawn on the deep-dive door (unknown posting, no profile) — so keyless CI never forks
// an interpreter here.
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { getJobseekerPosting, setPostingMatch, upsertPosting } from "../../../_lib/db/jobseeker-postings.ts";
import type { JobseekerPostingSummary, RawPosting } from "../../../_lib/jobseeker/types.ts";
import { GET } from "./route.ts";
import { PATCH } from "./[id]/route.ts";
import { POST as DEEPDIVE } from "./[id]/deepdive/route.ts";

after(() => cleanupUnitDb());

let seq = 0;
function raw(overrides: Partial<RawPosting> = {}): RawPosting {
  seq += 1;
  return {
    externalKey: `ext-${seq}`,
    url: `https://jobs.example/${seq}`,
    title: `Posting ${seq}`,
    company: "Example",
    location: "Praha",
    country: "cz",
    workMode: "hybrid",
    postedAt: null,
    salaryText: null,
    salary: null,
    bodyText: `We are hiring for role ${seq}.\nRequirements: TypeScript.`,
    jsonld: null,
    lang: "en",
    ...overrides,
  };
}

const T0 = "2026-09-16T08:00:00.000Z";
const SRC_A = "src-a";
const SRC_B = "src-b";

type Page = { rows: JobseekerPostingSummary[]; nextCursor: string | null };

const get = (query: string) => GET(new Request(`http://localhost/api/jobseeker/postings${query}`));
const patch = (id: string, body: unknown) =>
  PATCH(new Request(`http://localhost/api/jobseeker/postings/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

// Seed: five scored postings on source A (totals 90..50), one unscored on B.
const ids: string[] = [];
for (const total of [90, 80, 70, 60, 50]) {
  const { id } = upsertPosting(SRC_A, raw(), T0);
  setPostingMatch(id, { total, fitTier: "strong", eligibility: [{ key: "salary", state: "unknown", detail: "" }], confidence: { low: total - 5, high: total + 5, level: "tight" } }, {
    total,
    fitTier: total >= 70 ? "strong" : total >= 55 ? "promising" : "partial",
    version: "jobseeker-match-v1",
    matchedAt: T0,
  });
  ids.push(id);
}
const unscored = upsertPosting(SRC_B, raw(), T0).id;

test("GET: the default feed is live, total-sorted, nulls last, with the summary projection", async () => {
  const res = await get("");
  assert.equal(res.status, 200);
  const page = (await res.json()) as Page;
  assert.equal(page.rows.length, 6);
  assert.deepEqual(page.rows.map((r) => r.matchTotal), [90, 80, 70, 60, 50, null]);
  assert.equal(page.nextCursor, null);
  const first = page.rows[0] as JobseekerPostingSummary & Record<string, unknown>;
  assert.equal(first.deepDived, false);
  assert.equal(first.eligibility.length, 1, "eligibility is projected out of the stored match");
  assert.equal(first.confidence?.level, "tight");
  for (const heavy of ["bodyText", "jsonld", "job", "match", "reasoning", "contentHash"]) assert.ok(!(heavy in first), `${heavy} never ships on the feed`);
  assert.equal(typeof first.bodyChars, "number");
});

test("GET: filters — minTotal, sourceId, sort; an out-of-vocabulary value is a 400 with the field named", async () => {
  const min = (await (await get("?minTotal=70")).json()) as Page;
  assert.deepEqual(min.rows.map((r) => r.matchTotal), [90, 80, 70]);
  const bySource = (await (await get(`?sourceId=${SRC_B}`)).json()) as Page;
  assert.deepEqual(bySource.rows.map((r) => r.id), [unscored]);
  const seen = await get("?sort=seen&limit=2");
  assert.equal(seen.status, 200);
  assert.equal(((await seen.json()) as Page).rows.length, 2);

  for (const [query, field] of [
    ["?status=archived", "status"],
    ["?sort=random", "sort"],
    ["?limit=0", "limit"],
    ["?limit=101", "limit"],
    ["?minTotal=abc", "minTotal"],
  ] as const) {
    const bad = await get(query);
    assert.equal(bad.status, 400, query);
    const body = (await bad.json()) as { code: string; field: string };
    assert.equal(body.code, "APPLY_SELECTION_INVALID", query);
    assert.equal(body.field, field, query);
  }
});

test("GET: the cursor round-trips — three pages of 2 cover all six rows exactly once, then null", async () => {
  const seenIds: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const res = await get(`?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    assert.equal(res.status, 200);
    const page = (await res.json()) as Page;
    seenIds.push(...page.rows.map((r) => r.id));
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor && pages < 10);
  assert.equal(pages, 3);
  assert.equal(new Set(seenIds).size, 6, "no row repeated");
  assert.deepEqual([...seenIds].sort(), [...ids, unscored].sort(), "no row skipped — including the null-total tail");
});

test("PATCH: shortlisted moves the row and answers the summary; dismissed without a reason is a 400; unknown id is 404", async () => {
  const ok = await patch(ids[0], { status: "shortlisted" });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { posting: JobseekerPostingSummary };
  assert.equal(body.posting.id, ids[0]);
  assert.equal(body.posting.status, "shortlisted");
  assert.equal(getJobseekerPosting(ids[0])!.status, "shortlisted");

  const noReason = await patch(ids[1], { status: "dismissed" });
  assert.equal(noReason.status, 400);
  const nr = (await noReason.json()) as { code: string; field: string; options: string[] };
  assert.equal(nr.code, "APPLY_SELECTION_INVALID");
  assert.equal(nr.field, "dismissReason");
  assert.ok(nr.options.includes("salary"));
  assert.equal(getJobseekerPosting(ids[1])!.status, "new", "a refused dismiss writes nothing");

  const badReason = await patch(ids[1], { status: "dismissed", dismissReason: "vibes" });
  assert.equal(badReason.status, 400);

  const dismissed = await patch(ids[1], { status: "dismissed", dismissReason: "salary", note: "  under floor  " });
  assert.equal(dismissed.status, 200);
  const row = getJobseekerPosting(ids[1])!;
  assert.equal(row.status, "dismissed");
  assert.equal(row.dismissReason, "salary");
  assert.equal(row.dismissNote, "under floor");
  // …and it leaves the default (live) feed, but is reachable by status.
  const live = (await (await get("")).json()) as Page;
  assert.ok(!live.rows.some((r) => r.id === ids[1]));
  const only = (await (await get("?status=dismissed")).json()) as Page;
  assert.deepEqual(only.rows.map((r) => r.id), [ids[1]]);

  const gone = await patch(ids[2], { status: "gone" });
  assert.equal(gone.status, 400, "`gone` is the scan's verdict, not the seeker's");

  const missing = await patch("jpo-nope", { status: "applied" });
  assert.equal(missing.status, 404);
  assert.equal(((await missing.json()) as { code: string }).code, "POSTING_NOT_FOUND");
});

test("POST deepdive: an unknown posting is 404 and a workspace without a profile is 409 — both before any spawn", async () => {
  const req = (id: string) => new Request(`http://localhost/api/jobseeker/postings/${id}/deepdive`, { method: "POST" });
  const missing = await DEEPDIVE(req("jpo-nope"), { params: Promise.resolve({ id: "jpo-nope" }) });
  assert.equal(missing.status, 404);
  assert.equal(((await missing.json()) as { code: string }).code, "POSTING_NOT_FOUND");
  const noProfile = await DEEPDIVE(req(ids[0]), { params: Promise.resolve({ id: ids[0] }) });
  assert.equal(noProfile.status, 409);
  assert.equal(((await noProfile.json()) as { code: string }).code, "JOBSEEKER_PROFILE_MISSING");
});
