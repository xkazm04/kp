import test from "node:test";
import assert from "node:assert/strict";
import type { Entry } from "@/app/features/shared/decisionsTypes";
import { groupLedgerRows, ledgerKindOf, ledgerRowOf, parseApproval, sortLedgerRows } from "./decisionsLedgerModel";

const e = (id: string, over: Partial<Entry> = {}): Entry =>
  ({
    id,
    candidateId: id,
    candidateLabel: id,
    archetype: null,
    roleFamily: null,
    jobId: "job-a",
    jobTitle: "Backend",
    stage: "Screened",
    matchScore: null,
    status: "active",
    approvalKind: "screening_review",
    approvalDetail: JSON.stringify({ recommendation: "advance" }),
    ...over,
  }) as Entry;

test("the kind follows the approval kind, and a human scorecard names itself", () => {
  assert.equal(ledgerKindOf({ approvalKind: "offer_review" }, null), "offer");
  assert.equal(ledgerKindOf({ approvalKind: "rejection_review" }, null), "queuedReject");
  assert.equal(ledgerKindOf({ approvalKind: "scorecard_review" }, { source: "human" }), "humanScorecard");
  assert.equal(ledgerKindOf({ approvalKind: "scorecard_review" }, {}), "scorecard");
  assert.equal(ledgerKindOf({ approvalKind: "screening_review" }, null), "screening");
});

test("an unparseable approval renders as no proposal, never a crash", () => {
  assert.equal(parseApproval({ approvalDetail: "{not json" }), null);
  const row = ledgerRowOf(e("a", { approvalDetail: "{not json" }), null);
  assert.equal(row.recommendation, null);
});

test("an offer row carries the money and is not batchable; a screening row carries the verdict", () => {
  const offer = ledgerRowOf(
    e("o", { approvalKind: "offer_review", approvalDetail: JSON.stringify({ recommended: 62000, currency: "CZK" }) }),
    null,
  );
  assert.deepEqual(offer.offer, { amount: 62000, currency: "CZK" });
  assert.equal(offer.eligible, false);
  const screen = ledgerRowOf(e("s"), "2026-09-01T00:00:00Z");
  assert.equal(screen.recommendation, "advance");
  assert.equal(screen.eligible, true);
  assert.equal(screen.staleSince, "2026-09-01T00:00:00Z");
});

test("rows sort by role, then best fit first, unscored last", () => {
  const rows = [
    ledgerRowOf(e("b1", { jobTitle: "Backend", canonicalScore: 70 }), null),
    ledgerRowOf(e("a2", { jobTitle: "Analyst", jobId: "job-b" }), null),
    ledgerRowOf(e("b2", { jobTitle: "Backend", canonicalScore: 85 }), null),
    ledgerRowOf(e("a1", { jobTitle: "Analyst", jobId: "job-b", canonicalScore: 40 }), null),
  ];
  assert.deepEqual(sortLedgerRows(rows, "en").map((r) => r.entry.id), ["a1", "a2", "b2", "b1"]);
});

test("grouping folds the sorted rows by role and remembers the best fit", () => {
  const sorted = sortLedgerRows(
    [ledgerRowOf(e("b1", { canonicalScore: 70 }), null), ledgerRowOf(e("b2", { canonicalScore: 85 }), null), ledgerRowOf(e("a1", { jobId: "job-b", jobTitle: "Analyst" }), null)],
    "en",
  );
  const groups = groupLedgerRows(sorted);
  assert.deepEqual(groups.map((g) => [g.title, g.rows.length, g.best]), [["Analyst", 1, null], ["Backend", 2, 85]]);
});
