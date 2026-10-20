import { test } from "node:test";
import assert from "node:assert/strict";
import {
  priorRunQuery,
  summarizePriorRuns,
  type PriorRunRow,
} from "./analyzePriorRuns.ts";

test("priorRunQuery returns null in blind mode", () => {
  const hash = "a".repeat(64);
  const q = priorRunQuery({ cvHashes: [hash], jdSlug: "backend-dev", blind: true });
  assert.equal(q, null);
});

test("priorRunQuery returns null when hashes are empty or invalid", () => {
  assert.equal(priorRunQuery({ cvHashes: [], jdSlug: "backend-dev", blind: false }), null);
  assert.equal(priorRunQuery({ cvHashes: null, jdSlug: "backend-dev", blind: false }), null);
  assert.equal(
    priorRunQuery({ cvHashes: ["not-a-hex", "123", "g".repeat(64)], jdSlug: "backend-dev", blind: false }),
    null
  );
});

test("priorRunQuery drops invalid hashes and caps at MAX_CV_VARIANTS (3)", () => {
  const h1 = "1".repeat(64);
  const h2 = "2".repeat(64);
  const h3 = "3".repeat(64);
  const h4 = "4".repeat(64);
  const h5 = "5".repeat(64);
  const q = priorRunQuery({
    cvHashes: [h1, "invalid", h2, h3, h4, h5],
    jdSlug: " backend-dev ",
    blind: false,
  });
  assert.deepEqual(q, {
    cvHashes: [h1, h2, h3],
    jdSlug: "backend-dev",
  });
});

test("summarizePriorRuns returns 'none' for empty rows", () => {
  assert.deepEqual(summarizePriorRuns([], { jdSlug: "backend-dev" }), {
    verdict: "none",
  });
});

test("summarizePriorRuns returns 'seen-elsewhere' when CV appears only under other roles", () => {
  const rows: PriorRunRow[] = [
    {
      slug: "slug-role-1",
      candidate_label: "Candidate",
      jd_slug: "frontend-dev",
      score: 85,
      created_at: "2026-10-01T10:00:00Z",
      disposition: null,
      cv_hash: "a".repeat(64),
    },
    {
      slug: "slug-role-2",
      candidate_label: "Candidate",
      jd_slug: "data-eng",
      score: 72,
      created_at: "2026-10-02T10:00:00Z",
      disposition: null,
      cv_hash: "a".repeat(64),
    },
    {
      slug: "slug-role-3",
      candidate_label: "Candidate",
      jd_slug: "devops",
      score: 60,
      created_at: "2026-10-03T10:00:00Z",
      disposition: null,
      cv_hash: "a".repeat(64),
    },
    {
      slug: "slug-role-4",
      candidate_label: "Candidate",
      jd_slug: "qa-lead",
      score: 90,
      created_at: "2026-10-04T10:00:00Z",
      disposition: null,
      cv_hash: "a".repeat(64),
    },
  ];

  const summary = summarizePriorRuns(rows, { jdSlug: "backend-dev" });
  assert.equal(summary.verdict, "seen-elsewhere");
  if (summary.verdict === "seen-elsewhere") {
    assert.equal(summary.otherRoles.length, 3);
    assert.equal(summary.moreCount, 1);
    assert.equal(summary.otherRoles[0].slug, "slug-role-4"); // newest first
    assert.equal(summary.otherRoles[0].jdSlug, "qa-lead");
  }
});

test("summarizePriorRuns returns 'seen' when rows exist for target jdSlug but none decided", () => {
  const rows: PriorRunRow[] = [
    {
      slug: "slug-latest",
      candidate_label: "Candidate",
      jd_slug: "backend-dev",
      score: 78,
      created_at: "2026-10-04T12:00:00Z",
      disposition: null,
      cv_hash: "a".repeat(64),
    },
    {
      slug: "slug-older",
      candidate_label: "Candidate",
      jd_slug: "backend-dev",
      score: 70,
      created_at: "2026-10-01T12:00:00Z",
      disposition: null,
      cv_hash: "a".repeat(64),
    },
  ];

  const summary = summarizePriorRuns(rows, { jdSlug: "backend-dev" });
  assert.equal(summary.verdict, "seen");
  if (summary.verdict === "seen") {
    assert.deepEqual(summary.latest, {
      slug: "slug-latest",
      score: 78,
      createdAt: "2026-10-04T12:00:00Z",
    });
  }
});

test("summarizePriorRuns returns 'decided' when an older row carries a disposition", () => {
  const rows: PriorRunRow[] = [
    {
      slug: "slug-new-undecided",
      candidate_label: "Candidate",
      jd_slug: "backend-dev",
      score: 82,
      created_at: "2026-10-04T12:00:00Z",
      disposition: null,
      cv_hash: "a".repeat(64),
    },
    {
      slug: "slug-old-pass",
      candidate_label: "Candidate",
      jd_slug: "backend-dev",
      score: 80,
      created_at: "2026-09-20T12:00:00Z",
      disposition: "pass",
      cv_hash: "a".repeat(64),
    },
    {
      slug: "slug-other",
      candidate_label: "Candidate",
      jd_slug: "frontend-dev",
      score: 65,
      created_at: "2026-09-15T12:00:00Z",
      disposition: null,
      cv_hash: "a".repeat(64),
    },
  ];

  const summary = summarizePriorRuns(rows, { jdSlug: "backend-dev" });
  assert.equal(summary.verdict, "decided");
  if (summary.verdict === "decided") {
    assert.deepEqual(summary.decision, {
      disposition: "pass",
      slug: "slug-old-pass",
      createdAt: "2026-09-20T12:00:00Z",
    });
    assert.deepEqual(summary.latest, {
      slug: "slug-new-undecided",
      score: 82,
      createdAt: "2026-10-04T12:00:00Z",
    });
  }
});
