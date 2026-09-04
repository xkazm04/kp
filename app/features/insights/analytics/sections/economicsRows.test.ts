// The Economics board's three taxonomies must answer "we have no data" the SAME way.
//
// The defect: `byVariant` carries no rate from the server, so the board computed
// `r.total ? Math.round(...) : 0` inline — a literal 0 % for a creative nobody has
// ever applied through. Beside it, the roles table prints "—" for exactly that
// situation, and the board's own SORTER already treated it as absent (`total === 0
// ? null : …`). Three places, two answers, and the one a reader actually sees was
// the wrong one: a variant reading "0 % hire rate" is a verdict on a creative that
// has never been run.
//
// Pinned here rather than in the component because the fix is the normalization,
// not the markup: the rate is now a value whose absent case is `null`, produced once
// for all three groups.
//
// Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { economicsRows, hireRate, type EconomicsRow } from "./economicsRows.ts";
import type { EconomicsAnalytics } from "./economicsTypes.ts";

/** Only the three group arrays are read; the rest of the payload is irrelevant here. */
const payload = (parts: Partial<EconomicsAnalytics>): EconomicsAnalytics =>
  ({ byChannel: [], bySource: [], byVariant: [], ...parts }) as EconomicsAnalytics;

const names = { channel: (c: string) => `#${c}`, source: (s: string) => `~${s}` };
const rateOf = (rows: EconomicsRow[], key: string) => rows.find((r) => r.key === key)?.hireRatePct;

test("hireRate is absent, not zero, over an empty population", () => {
  assert.equal(hireRate(0, 0), null, "no applicants means there is no rate to state");
  assert.equal(hireRate(0, 10), 0, "ten applicants and no hire IS a zero — that one is a measurement");
  assert.equal(hireRate(3, 10), 30);
  // Rounded, so the column reads the same way down its whole length.
  assert.equal(hireRate(1, 3), 33);
});

test("all three taxonomies mark an empty surface absent, never 0%", () => {
  const rows = economicsRows(
    payload({
      // The SERVER sends a number for an empty channel/source row; the board must
      // not pass it through, or the fabricated zero comes back one layer up.
      byChannel: [{ channel: "linkedin", total: 0, reachedInterview: 0, hired: 0, hireRatePct: 0 }],
      bySource: [{ source: "referral", total: 0, reachedInterview: 0, hired: 0, hireRatePct: 0 }],
      byVariant: [{ variant: "A", jobTitle: "Backend Engineer", campaign: "spring", total: 0, reachedInterview: 0, hired: 0 }],
    } as unknown as Partial<EconomicsAnalytics>),
    names
  );
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.equal(r.hireRatePct, null, `${r.kind} invented a rate for a surface with no applicants`);
  }
});

test("a populated row keeps the rate the server computed", () => {
  const rows = economicsRows(
    payload({
      byChannel: [{ channel: "linkedin", total: 20, reachedInterview: 8, hired: 3, hireRatePct: 15 }],
      bySource: [{ source: "referral", total: 8, reachedInterview: 4, hired: 1, hireRatePct: 13 }],
      byVariant: [{ variant: "A", jobTitle: "Backend Engineer", campaign: "spring", total: 4, reachedInterview: 2, hired: 1 }],
    } as unknown as Partial<EconomicsAnalytics>),
    names
  );
  assert.equal(rateOf(rows, "channel:linkedin"), 15);
  // Re-derived from the same hired/total, so it agrees with the server's own value.
  assert.equal(rateOf(rows, "source:referral"), 13);
  // The group the server sends no rate for at all.
  assert.equal(rateOf(rows, "variant:Backend Engineer:spring:A"), 25);
});

test("a variant's identity stays inside its campaign and role", () => {
  const rows = economicsRows(
    payload({
      byVariant: [
        { variant: "A", jobTitle: "Backend Engineer", campaign: "spring", total: 4, hired: 1, reachedInterview: 2 },
        { variant: "A", jobTitle: "Data Analyst", campaign: "spring", total: 2, hired: 0, reachedInterview: 1 },
      ],
    } as unknown as Partial<EconomicsAnalytics>),
    names
  );
  assert.equal(new Set(rows.map((r) => r.key)).size, 2, "two roles running an 'A' variant are two rows, never merged");
});

test("only channels carry a spend figure; the other two are absent, not free", () => {
  const rows = economicsRows(
    payload({
      byChannel: [{ channel: "linkedin", total: 20, reachedInterview: 8, hired: 3, hireRatePct: 15, spendCzk: 5000, spendUpdatedAt: "2026-01-01T00:00:00.000Z", costPerHireCzk: 1667 }],
      bySource: [{ source: "referral", total: 8, reachedInterview: 4, hired: 1, hireRatePct: 13 }],
      byVariant: [{ variant: "A", jobTitle: "Backend Engineer", campaign: "spring", total: 4, hired: 1, reachedInterview: 2 }],
    } as unknown as Partial<EconomicsAnalytics>),
    names
  );
  assert.equal(rows.find((r) => r.kind === "channel")?.spendCzk, 5000);
  for (const kind of ["source", "variant"] as const) {
    const row = rows.find((r) => r.kind === kind)!;
    assert.equal(row.spendCzk, null, "spend is recorded per channel; a zero here would read as 'free'");
    assert.equal(row.costPerHireCzk, null);
  }
});

test("the stored channel id, not the label, is what the row carries as its write key", () => {
  const rows = economicsRows(
    payload({ byChannel: [{ channel: "linkedin", total: 1, reachedInterview: 0, hired: 0, hireRatePct: 0 }] } as unknown as Partial<EconomicsAnalytics>),
    names
  );
  assert.equal(rows[0].channelId, "linkedin", "the spend endpoint and the board's ?source= filter key off the stored id");
  assert.equal(rows[0].name, "#linkedin", "…while the display name is the localized label");
});
