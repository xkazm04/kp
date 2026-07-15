// Locks the pure parser for the two re-engagement event details (rematch-story-
// navigable). The exact detail formats are written by db/pipeline.ts (rematched) and
// rediscovery-prior-link.ts (rematched_from); this test pins that the parser reads
// them back symmetrically and degrades to null on anything malformed — the guarantee
// that a bad detail can never render as a broken link.
//
// Runner: Node's built-in test runner with type stripping.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRematchDetail, isRematchKind } from "./pipeline-rematch-link.ts";

test("rematched (source side) → the target entry it was redirected into", () => {
  // db/pipeline.ts: `${row.job_id ?? "?"} -> ${targetJobId} (${targetEntryId})`
  assert.deepEqual(parseRematchDetail("rematched", "jd-backend -> jd-frontend (pe_target_1)"), {
    entryId: "pe_target_1",
    jobId: "jd-frontend",
  });
  // A missing source job ("?") still resolves the target; the source job side is
  // irrelevant to the counterpart.
  assert.deepEqual(parseRematchDetail("rematched", "? -> corpus-42 (pe_x)"), {
    entryId: "pe_x",
    jobId: "corpus-42",
  });
  // A "?" target job normalizes to null jobId, entry still parses.
  assert.deepEqual(parseRematchDetail("rematched", "jd-a -> ? (pe_y)"), { entryId: "pe_y", jobId: null });
});

test("rematched_from (target side) → the prior entry it was re-engaged from", () => {
  // rediscovery-prior-link.ts: `${prior.id} (${prior.jobId ?? "?"})`
  assert.deepEqual(parseRematchDetail("rematched_from", "pe_prior_9 (jd-old-role)"), {
    entryId: "pe_prior_9",
    jobId: "jd-old-role",
  });
  // A prior with an unknown job ("?") still resolves the entry; jobId → null.
  assert.deepEqual(parseRematchDetail("rematched_from", "pe_prior_9 (?)"), { entryId: "pe_prior_9", jobId: null });
});

test("malformed / mismatched / empty details resolve to null (never a broken link)", () => {
  assert.equal(parseRematchDetail("rematched", null), null);
  assert.equal(parseRematchDetail("rematched", undefined), null);
  assert.equal(parseRematchDetail("rematched", ""), null);
  assert.equal(parseRematchDetail("rematched", "no arrow, no parens"), null);
  assert.equal(parseRematchDetail("rematched", "jd-a -> jd-b ()"), null); // empty entry id
  assert.equal(parseRematchDetail("rematched_from", "just-an-id-no-parens"), null);
  assert.equal(parseRematchDetail("rematched_from", "()"), null); // no entry id
  // A non-rematch kind never parses, even if the string happens to look shaped.
  assert.equal(parseRematchDetail("moved", "pe_x (jd-a)"), null);
  assert.equal(parseRematchDetail("scored", "a -> b (c)"), null);
});

test("isRematchKind covers both sides and nothing else", () => {
  assert.equal(isRematchKind("rematched"), true);
  assert.equal(isRematchKind("rematched_from"), true);
  assert.equal(isRematchKind("moved"), false);
  assert.equal(isRematchKind("matched"), false);
});
