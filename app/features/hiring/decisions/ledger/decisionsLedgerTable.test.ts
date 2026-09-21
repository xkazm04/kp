import test from "node:test";
import assert from "node:assert/strict";
import type { Entry } from "@/app/features/shared/decisionsTypes";
import { ledgerRowOf } from "./decisionsLedgerModel";
import { EMPTY_FILTERS, filterLedgerRows, groupKeepingOrder, groupPage, isFiltering, proposalKey } from "./decisionsLedgerTable";

const e = (id: string, over: Partial<Entry> = {}): Entry =>
  ({ id, candidateId: id, candidateLabel: id, archetype: null, roleFamily: null, jobId: "job-a", jobTitle: "Backend", stage: "Screened", matchScore: null, status: "active", approvalKind: "screening_review", approvalDetail: JSON.stringify({ recommendation: "advance" }), ...over }) as Entry;
const row = (id: string, over: Partial<Entry> = {}) => ledgerRowOf(e(id, over), null);

test("filters match name (substring), role, stage and the proposal", () => {
  const rows = [row("Anna"), row("Bob", { jobId: "job-b", jobTitle: "Analyst", stage: "Interview", approvalDetail: JSON.stringify({ recommendation: "hold" }) })];
  assert.deepEqual(filterLedgerRows(rows, { ...EMPTY_FILTERS, name: "nn" }).map((r) => r.entry.id), ["Anna"]);
  assert.deepEqual(filterLedgerRows(rows, { ...EMPTY_FILTERS, role: "job-b" }).map((r) => r.entry.id), ["Bob"]);
  assert.deepEqual(filterLedgerRows(rows, { ...EMPTY_FILTERS, stage: "Interview" }).map((r) => r.entry.id), ["Bob"]);
  assert.deepEqual(filterLedgerRows(rows, { ...EMPTY_FILTERS, recommended: "hold" }).map((r) => r.entry.id), ["Bob"]);
  assert.equal(isFiltering(EMPTY_FILTERS), false);
  assert.equal(isFiltering({ ...EMPTY_FILTERS, name: " x" }), true);
});

test("an offer row filters under 'offer', a verdict row under its verdict", () => {
  assert.equal(proposalKey(row("o", { approvalKind: "offer_review", approvalDetail: JSON.stringify({ recommended: 1 }) })), "offer");
  assert.equal(proposalKey(row("s")), "advance");
});

test("groups follow the sort's first appearance and keep their rows together", () => {
  // Sorted by score desc across roles: Analyst's 90 leads, so Analyst groups first,
  // and Backend's two rows (85, 70) stay adjacent even though Analyst's 60 sits between.
  const sorted = [
    row("a1", { jobId: "job-b", jobTitle: "Analyst", canonicalScore: 90 }),
    row("b1", { canonicalScore: 85 }),
    row("b2", { canonicalScore: 70 }),
    row("a2", { jobId: "job-b", jobTitle: "Analyst", canonicalScore: 60 }),
  ];
  const { groups, flat } = groupKeepingOrder(sorted);
  assert.deepEqual(groups.map((g) => [g.title, g.rows.map((r) => r.entry.id), g.best]), [["Analyst", ["a1", "a2"], 90], ["Backend", ["b1", "b2"], 85]]);
  assert.deepEqual(flat.map((r) => r.entry.id), ["a1", "a2", "b1", "b2"]);
  assert.deepEqual(groupPage(flat.slice(1, 3)).map((g) => g.rows.map((r) => r.entry.id)), [["a2"], ["b1"]]);
});
