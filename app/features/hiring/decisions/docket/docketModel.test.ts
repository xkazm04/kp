import assert from "node:assert/strict";
import { test } from "node:test";
import type { Entry } from "@/app/features/shared/decisionsTypes";
import type { LedgerRow } from "../ledger/decisionsLedgerModel";
import { docketGroups, docketHeadline, proposalOf } from "./docketModel";

const entry = (id: string, job: string, title: string): Entry => ({ id, jobId: job, jobTitle: title, candidateLabel: id, stage: "Screened" }) as unknown as Entry;
const row = (id: string, job: string, score: number | null, rec: LedgerRow["recommendation"], over: Partial<LedgerRow> = {}): LedgerRow => ({
  entry: entry(id, job, job.toUpperCase()), kind: "screening", recommendation: rec, offer: null, score, eligible: true, staleSince: null, ...over,
});

test("a row with no recorded proposal is none, never hold", () => {
  assert.equal(proposalOf(row("a", "x", 50, null)), "none");
  assert.equal(proposalOf(row("a", "x", 50, "hold")), "hold");
  assert.equal(proposalOf(row("a", "x", 50, null, { kind: "offer" })), "offer");
});

test("groups fold by role, best fit first, unscored last, counting rejects and stale", () => {
  const g = docketGroups(
    [row("u", "b", null, null), row("lo", "b", 40, "reject"), row("hi", "b", 70, "advance", { staleSince: "2026-09-01" }), row("z", "a", 10, "hold")],
    "en",
  );
  assert.deepEqual(g.map((x) => x.key), ["a", "b"]);
  assert.deepEqual(g[1].rows.map((r) => r.entry.id), ["hi", "lo", "u"]);
  assert.equal(g[1].best, 70);
  assert.equal(g[1].rejects, 1);
  assert.equal(g[1].stale, 1);
});

test("the headline counts every pending entry, the proposal split only the rows", () => {
  const rows = [row("1", "a", 60, "reject"), row("2", "a", 50, null), row("3", "b", 40, "advance")];
  const pending = [...rows.map((r) => r.entry), entry("k1", "a", "A"), entry("k2", "c", "C")];
  const h = docketHeadline(rows, pending);
  assert.equal(h.waiting, 5);
  assert.equal(h.roles, 3);
  assert.equal(h.proposed, 2);
  assert.equal(h.unproposed, 1);
  assert.equal(h.rejects, 1);
  assert.deepEqual(h.biggest, { title: "A", count: 3 });
  assert.equal(docketHeadline([], []).biggest, null);
});
