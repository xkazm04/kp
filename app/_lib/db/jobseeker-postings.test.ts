// Behaviour of the job-seeker posting store on an isolated throwaway DB — unit-db.ts
// must be the first project import (it sets KP_DB_PATH before any store opens a
// connection). Covers the reconciliation contract a scan relies on: new / changed /
// unchanged, the two-miss road to 'gone' and the revival on re-sight, and the keyset
// pager with its minTotal filter.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import type { RawPosting } from "../jobseeker/types.ts";
import {
  getJobseekerPosting,
  getPostingSummary,
  listDeepDiveCandidates,
  listJobseekerPostings,
  listPostingsForMatching,
  markAbsent,
  setPostingMatch,
  setPostingStructure,
  setJobseekerPostingStatus,
  setPostingBlocked,
  upsertPosting,
} from "./jobseeker-postings.ts";

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
const T1 = "2026-09-16T09:00:00.000Z";
const T2 = "2026-09-16T10:00:00.000Z";
const T3 = "2026-09-16T11:00:00.000Z";

test("upsertPosting: new, then unchanged (whitespace-only drift), then changed (body moved)", () => {
  const source = "src-upsert";
  const first = raw();
  const a = upsertPosting(source, first, T0);
  assert.equal(a.outcome, "new");

  // Same content re-rendered with different whitespace and case is NOT a change.
  const b = upsertPosting(source, { ...first, bodyText: first.bodyText.toUpperCase().replace(/\s+/g, "   ") }, T1);
  assert.equal(b.outcome, "unchanged");
  assert.equal(b.id, a.id);
  const afterUnchanged = getJobseekerPosting(a.id)!;
  assert.equal(afterUnchanged.lastSeenAt, T1, "unchanged bumps last_seen_at");
  assert.equal(afterUnchanged.firstSeenAt, T0, "…and only last_seen_at");

  // Give it a match, then change the body: the match must be cleared for re-scoring.
  setPostingMatch(a.id, { total: 80 }, { total: 80, fitTier: "strong", version: "v1", matchedAt: T1 });
  const c = upsertPosting(source, { ...first, bodyText: "A different advertisement entirely." }, T2);
  assert.equal(c.outcome, "changed");
  assert.equal(c.id, a.id, "same (source, external_key) is the same row");
  const afterChanged = getJobseekerPosting(a.id)!;
  assert.equal(afterChanged.bodyText, "A different advertisement entirely.");
  assert.equal(afterChanged.matchTotal, null, "a changed body invalidates the match projection");
  assert.equal(afterChanged.match, null);
  assert.equal(afterChanged.lastSeenAt, T2);
});

test("markAbsent: a single miss is not gone; two consecutive misses are; a re-sight revives", () => {
  const source = "src-absent";
  const seen = upsertPosting(source, raw(), T0);
  const kept = upsertPosting(source, raw(), T0);

  // Scan at T1 sees only `kept`.
  upsertPosting(source, raw({ externalKey: getJobseekerPosting(kept.id)!.externalKey }), T1);
  assert.equal(markAbsent(source, T1), 0, "first miss moves nothing to gone");
  let row = getJobseekerPosting(seen.id)!;
  assert.equal(row.status, "new");
  assert.ok(row.goneAt, "first miss stamps gone_at as the marker");
  assert.equal(getJobseekerPosting(kept.id)!.goneAt, null, "a seen posting is not marked");

  // Scan at T2 again sees only `kept`.
  upsertPosting(source, raw({ externalKey: getJobseekerPosting(kept.id)!.externalKey }), T2);
  assert.equal(markAbsent(source, T2), 1, "second consecutive miss moves exactly one to gone");
  row = getJobseekerPosting(seen.id)!;
  assert.equal(row.status, "gone");
  assert.equal(getJobseekerPosting(kept.id)!.status, "new");

  // The posting is back at T3: revived to 'new', marker cleared.
  const back = upsertPosting(source, raw({ externalKey: row.externalKey, bodyText: `We are hiring for role ${row.externalKey}.` }), T3);
  assert.equal(back.id, seen.id);
  row = getJobseekerPosting(seen.id)!;
  assert.equal(row.status, "new");
  assert.equal(row.goneAt, null);
  assert.equal(row.lastSeenAt, T3);

  // A missed posting whose gone_at was cleared by the revival starts the count over.
  assert.equal(markAbsent(source, "2026-09-16T12:00:00.000Z"), 0);
});

test("markAbsent leaves the seeker's own statuses alone except the terminal move to gone", () => {
  const source = "src-absent-status";
  const p = upsertPosting(source, raw(), T0);
  setJobseekerPostingStatus(p.id, "shortlisted", null);
  markAbsent(source, T1);
  assert.equal(getJobseekerPosting(p.id)!.status, "shortlisted", "first miss does not touch status");
  markAbsent(source, T2);
  assert.equal(getJobseekerPosting(p.id)!.status, "gone", "second miss does — a withdrawn opening cannot stay shortlisted");
});

test("listJobseekerPostings: keyset paging by total walks every row once, nulls last; minTotal filters", () => {
  const source = "src-list";
  const totals: (number | null)[] = [90, 70, 70, 50, null, 30, null];
  const ids: string[] = [];
  for (const total of totals) {
    const { id } = upsertPosting(source, raw(), T0);
    ids.push(id);
    if (total !== null) setPostingMatch(id, { total }, { total, fitTier: "promising", version: "v1", matchedAt: T0 });
  }

  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = listJobseekerPostings({ sourceId: source, sort: "total", limit: 3, cursor }, undefined);
    pages += 1;
    for (const row of page.rows) seen.push(row.id);
    cursor = page.nextCursor;
  } while (cursor && pages < 10);
  assert.equal(pages, 3, "7 rows at 3 per page is 3 pages");
  assert.equal(seen.length, 7, "every row handed out exactly once");
  assert.deepEqual([...new Set(seen)].length, 7, "no repeats across page boundaries");
  // Order: totals descending, then the two unmatched rows at the tail.
  const totalsSeen = seen.map((id) => getJobseekerPosting(id)!.matchTotal);
  assert.deepEqual(totalsSeen.slice(0, 5), [90, 70, 70, 50, 30]);
  assert.deepEqual(totalsSeen.slice(5), [null, null]);

  const filtered = listJobseekerPostings({ sourceId: source, minTotal: 60, limit: 50 });
  assert.deepEqual(
    filtered.rows.map((r) => r.matchTotal),
    [90, 70, 70],
    "minTotal drops the lower and the unmatched rows"
  );
  assert.equal(filtered.nextCursor, null, "a page under the limit has no next cursor");

  // The summary projection carries no body and reports deep-dive state.
  const row = filtered.rows[0];
  assert.equal("bodyText" in row, false);
  assert.ok(row.bodyChars > 0);
  assert.equal(row.deepDived, false);
  assert.deepEqual(row.eligibility, []);
  assert.equal(row.confidence, null);
});

test("listJobseekerPostings: a garbage cursor starts from the top instead of throwing", () => {
  const source = "src-cursor";
  upsertPosting(source, raw(), T0);
  const page = listJobseekerPostings({ sourceId: source, cursor: "not-a-cursor" });
  assert.equal(page.rows.length, 1);
});

test("upsertPosting persists the adapter's salary parse and clears it when a re-seen posting drops the figure", () => {
  const source = "src-salary";
  const first = raw({ salary: { min: 70000, max: 95000, currency: "czk", period: "month" }, salaryText: "70 000 – 95 000 Kč" });
  const a = upsertPosting(source, first, T0);
  const stored = getJobseekerPosting(a.id)!;
  assert.equal(stored.salaryMin, 70000);
  assert.equal(stored.salaryMax, 95000);
  assert.equal(stored.salaryCurrency, "CZK", "currency is stored upper-cased");
  assert.equal(stored.salaryPeriod, "month");
  // The body changes and the pay is no longer stated: the columns follow the posting, never a stale figure.
  const b = upsertPosting(source, { ...first, bodyText: "Rewritten without pay.", salary: null }, T1);
  assert.equal(b.outcome, "changed");
  const after = getJobseekerPosting(a.id)!;
  assert.equal(after.salaryMin, null);
  assert.equal(after.salaryCurrency, null);
  assert.equal(after.salaryPeriod, null);
  // A salary without a currency, or with a period outside the vocabulary, is not a salary.
  const c = upsertPosting(source, raw({ salary: { min: 10, max: 20, currency: "", period: "month" } }), T0);
  assert.equal(getJobseekerPosting(c.id)!.salaryMin, null);
  const d = upsertPosting(source, raw({ salary: { min: 10, max: 20, currency: "EUR", period: "hour" as unknown as "month" } }), T0);
  assert.equal(getJobseekerPosting(d.id)!.salaryMin, null);
});

test("listPostingsForMatching: scoped, it returns only the rows that still owe a score", () => {
  const source = "src-incremental";
  const ws = "ws-incremental";
  const a = upsertPosting(source, raw(), T0, ws);
  const b = upsertPosting(source, raw(), T0, ws);
  const c = upsertPosting(source, raw(), T0, ws);
  for (const id of [a.id, b.id, c.id]) setPostingStructure(id, { title: "x" }, "deterministic", ws);

  const scope = { upToDateVersion: "jobseeker-match-v1", profileUpdatedAt: T1 };
  // Nothing matched yet: all three owe a score and none is skipped.
  const none = listPostingsForMatching(ws, scope);
  assert.equal(none.rows.length, 3, "a never-matched row is never skipped (the NULL trap)");
  assert.equal(none.skippedUpToDate, 0);

  // a: current. b: the older matcher. c: scored BEFORE the profile last changed.
  setPostingMatch(a.id, { jobId: a.id }, { total: 70, fitTier: "strong", version: "jobseeker-match-v1", matchedAt: T2 }, ws);
  setPostingMatch(b.id, { jobId: b.id }, { total: 70, fitTier: "strong", version: "jobseeker-match-v0", matchedAt: T2 }, ws);
  setPostingMatch(c.id, { jobId: c.id }, { total: 70, fitTier: "strong", version: "jobseeker-match-v1", matchedAt: T0 }, ws);

  const scoped = listPostingsForMatching(ws, scope);
  assert.deepEqual(scoped.rows.map((r) => r.id).sort(), [b.id, c.id].sort(), "an older version and a pre-profile score both come back");
  assert.equal(scoped.skippedUpToDate, 1, "only the row matched by this version after the profile moved is skipped");

  // Unscoped is the pre-incremental sweep: every live structured row, nothing skipped.
  const all = listPostingsForMatching(ws);
  assert.equal(all.rows.length, 3);
  assert.equal(all.skippedUpToDate, 0);

  // A dismissed row leaves the matching set whatever its match state is.
  setJobseekerPostingStatus(a.id, "dismissed", { reason: "salary", note: null }, ws);
  assert.equal(listPostingsForMatching(ws, scope).skippedUpToDate, 0);
  // …and another workspace sees none of it.
  assert.equal(listPostingsForMatching("ws-other", scope).rows.length, 0);
});

test("setPostingBlocked: stamps the verdict with no total, is skipped by the next scan, and projects blockedBy", () => {
  const source = "src-blocked";
  const ws = "ws-blocked";
  const blocked = upsertPosting(source, raw(), T0, ws);
  const scored = upsertPosting(source, raw(), T0, ws);
  for (const id of [blocked.id, scored.id]) setPostingStructure(id, { title: "x" }, "deterministic", ws);
  const asIf = { jobId: blocked.id, total: 88, fitTier: "strong", eligibility: [{ key: "work_mode", state: "flag", detail: "work mode onsite not preferred" }] };
  const verdict = { blocked: { koKeys: ["work_mode"], koDetails: ["work mode onsite not preferred"] }, asIf };
  assert.equal(setPostingBlocked(blocked.id, verdict, { version: "jobseeker-match-v2", matchedAt: T2 }, ws), true);
  setPostingMatch(scored.id, { jobId: scored.id, eligibility: [] }, { total: 70, fitTier: "strong", version: "jobseeker-match-v2", matchedAt: T2 }, ws);

  const row = getJobseekerPosting(blocked.id, ws)!;
  assert.equal(row.matchTotal, null, "the as-if score never becomes the sort column");
  assert.equal(row.fitTier, null);
  assert.equal(row.matchVersion, "jobseeker-match-v2");
  assert.equal(row.matchedAt, T2);
  assert.deepEqual(row.match, verdict);

  const scope = { upToDateVersion: "jobseeker-match-v2", profileUpdatedAt: T1 };
  const pending = listPostingsForMatching(ws, scope);
  assert.equal(pending.rows.length, 0, "a stamped verdict is current: the next unchanged scan does not re-send it");
  assert.equal(pending.skippedUpToDate, 2);

  const byId = new Map(listJobseekerPostings({}, ws).rows.map((r) => [r.id, r]));
  assert.deepEqual(byId.get(blocked.id)!.blockedBy, ["work_mode"]);
  assert.deepEqual(byId.get(blocked.id)!.eligibility, [], "the as-if flags are not the row's own eligibility");
  assert.deepEqual(byId.get(scored.id)!.blockedBy, []);
  assert.deepEqual(getPostingSummary(blocked.id, ws)!.blockedBy, ["work_mode"]);

  // An as-if 88 never reaches the deep-dive shortlist: it reads match_total, which is NULL.
  assert.deepEqual(listDeepDiveCandidates({ threshold: 0, limit: 10 }, ws).map((p) => p.id), [scored.id]);
});

test("setPostingBlocked re-checks instead of locking: a posting whose content changed after the list is not stamped", () => {
  const source = "src-blocked-race";
  const ws = "ws-blocked-race";
  const first = raw();
  const p = upsertPosting(source, first, T0, ws);
  setPostingStructure(p.id, { title: "x" }, "deterministic", ws);
  // The scan listed it; then a concurrent reconcile saw new content, which NULLs job_json.
  assert.equal(upsertPosting(source, { ...first, bodyText: `${first.bodyText} Now onsite only.` }, T1, ws).outcome, "changed");
  const stamped = setPostingBlocked(p.id, { blocked: { koKeys: ["work_mode"], koDetails: ["x"] }, asIf: { total: 50 } }, { version: "jobseeker-match-v2", matchedAt: T2 }, ws);
  assert.equal(stamped, false, "changes === 0: the verdict was computed from content that no longer exists");
  const row = getJobseekerPosting(p.id, ws)!;
  assert.equal(row.match, null);
  assert.equal(row.matchVersion, null, "so the next scan structures and matches it afresh");
  // …and a foreign workspace cannot stamp it either.
  setPostingStructure(p.id, { title: "x" }, "deterministic", ws);
  assert.equal(setPostingBlocked(p.id, { blocked: { koKeys: [], koDetails: [] }, asIf: {} }, { version: "v", matchedAt: T2 }, "ws-other"), false);
});
