// Behaviour of the job-seeker posting store on an isolated throwaway DB — unit-db.ts
// must be the first project import (it sets KP_DB_PATH before any store opens a
// connection). Covers the reconciliation contract a scan relies on: new / changed /
// unchanged, the two-miss road to 'gone' and the revival on re-sight, and the keyset
// pager with its minTotal filter.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import type { RawPosting } from "../jobseeker/types.ts";
import { getPosting, listPostings, markAbsent, setPostingMatch, setPostingStatus, upsertPosting } from "./jobseeker-postings.ts";

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
  const afterUnchanged = getPosting(a.id)!;
  assert.equal(afterUnchanged.lastSeenAt, T1, "unchanged bumps last_seen_at");
  assert.equal(afterUnchanged.firstSeenAt, T0, "…and only last_seen_at");

  // Give it a match, then change the body: the match must be cleared for re-scoring.
  setPostingMatch(a.id, { total: 80 }, { total: 80, fitTier: "strong", version: "v1", matchedAt: T1 });
  const c = upsertPosting(source, { ...first, bodyText: "A different advertisement entirely." }, T2);
  assert.equal(c.outcome, "changed");
  assert.equal(c.id, a.id, "same (source, external_key) is the same row");
  const afterChanged = getPosting(a.id)!;
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
  upsertPosting(source, raw({ externalKey: getPosting(kept.id)!.externalKey }), T1);
  assert.equal(markAbsent(source, T1), 0, "first miss moves nothing to gone");
  let row = getPosting(seen.id)!;
  assert.equal(row.status, "new");
  assert.ok(row.goneAt, "first miss stamps gone_at as the marker");
  assert.equal(getPosting(kept.id)!.goneAt, null, "a seen posting is not marked");

  // Scan at T2 again sees only `kept`.
  upsertPosting(source, raw({ externalKey: getPosting(kept.id)!.externalKey }), T2);
  assert.equal(markAbsent(source, T2), 1, "second consecutive miss moves exactly one to gone");
  row = getPosting(seen.id)!;
  assert.equal(row.status, "gone");
  assert.equal(getPosting(kept.id)!.status, "new");

  // The posting is back at T3: revived to 'new', marker cleared.
  const back = upsertPosting(source, raw({ externalKey: row.externalKey, bodyText: `We are hiring for role ${row.externalKey}.` }), T3);
  assert.equal(back.id, seen.id);
  row = getPosting(seen.id)!;
  assert.equal(row.status, "new");
  assert.equal(row.goneAt, null);
  assert.equal(row.lastSeenAt, T3);

  // A missed posting whose gone_at was cleared by the revival starts the count over.
  assert.equal(markAbsent(source, "2026-09-16T12:00:00.000Z"), 0);
});

test("markAbsent leaves the seeker's own statuses alone except the terminal move to gone", () => {
  const source = "src-absent-status";
  const p = upsertPosting(source, raw(), T0);
  setPostingStatus(p.id, "shortlisted", null);
  markAbsent(source, T1);
  assert.equal(getPosting(p.id)!.status, "shortlisted", "first miss does not touch status");
  markAbsent(source, T2);
  assert.equal(getPosting(p.id)!.status, "gone", "second miss does — a withdrawn opening cannot stay shortlisted");
});

test("listPostings: keyset paging by total walks every row once, nulls last; minTotal filters", () => {
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
    const page = listPostings({ sourceId: source, sort: "total", limit: 3, cursor }, undefined);
    pages += 1;
    for (const row of page.rows) seen.push(row.id);
    cursor = page.nextCursor;
  } while (cursor && pages < 10);
  assert.equal(pages, 3, "7 rows at 3 per page is 3 pages");
  assert.equal(seen.length, 7, "every row handed out exactly once");
  assert.deepEqual([...new Set(seen)].length, 7, "no repeats across page boundaries");
  // Order: totals descending, then the two unmatched rows at the tail.
  const totalsSeen = seen.map((id) => getPosting(id)!.matchTotal);
  assert.deepEqual(totalsSeen.slice(0, 5), [90, 70, 70, 50, 30]);
  assert.deepEqual(totalsSeen.slice(5), [null, null]);

  const filtered = listPostings({ sourceId: source, minTotal: 60, limit: 50 });
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

test("listPostings: a garbage cursor starts from the top instead of throwing", () => {
  const source = "src-cursor";
  upsertPosting(source, raw(), T0);
  const page = listPostings({ sourceId: source, cursor: "not-a-cursor" });
  assert.equal(page.rows.length, 1);
});

test("upsertPosting persists the adapter's salary parse and clears it when a re-seen posting drops the figure", () => {
  const source = "src-salary";
  const first = raw({ salary: { min: 70000, max: 95000, currency: "czk", period: "month" }, salaryText: "70 000 – 95 000 Kč" });
  const a = upsertPosting(source, first, T0);
  const stored = getPosting(a.id)!;
  assert.equal(stored.salaryMin, 70000);
  assert.equal(stored.salaryMax, 95000);
  assert.equal(stored.salaryCurrency, "CZK", "currency is stored upper-cased");
  assert.equal(stored.salaryPeriod, "month");
  // The body changes and the pay is no longer stated: the columns follow the posting, never a stale figure.
  const b = upsertPosting(source, { ...first, bodyText: "Rewritten without pay.", salary: null }, T1);
  assert.equal(b.outcome, "changed");
  const after = getPosting(a.id)!;
  assert.equal(after.salaryMin, null);
  assert.equal(after.salaryCurrency, null);
  assert.equal(after.salaryPeriod, null);
  // A salary without a currency, or with a period outside the vocabulary, is not a salary.
  const c = upsertPosting(source, raw({ salary: { min: 10, max: 20, currency: "", period: "month" } }), T0);
  assert.equal(getPosting(c.id)!.salaryMin, null);
  const d = upsertPosting(source, raw({ salary: { min: 10, max: 20, currency: "EUR", period: "hour" as unknown as "month" } }), T0);
  assert.equal(getPosting(d.id)!.salaryMin, null);
});
