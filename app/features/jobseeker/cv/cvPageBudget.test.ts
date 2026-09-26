import { test } from "node:test";
import assert from "node:assert/strict";
import { CV_FIRST_PAGE_MM, CV_NEXT_PAGE_MM, cvIntervalOf, cvPageBudget, cvPageVerdict, cvYearsOf } from "./cvPageBudget";

// Registry recruiting/cv-presentation-and-parseability, type-scale-density-and-page-budget:
// one page under about three years, two otherwise; a second page at least a third full.

const NOW = new Date(2026, 8, 26);

test("a date string reads as an interval, 'present' in the CV's own language ends now", () => {
  assert.deepEqual(cvIntervalOf("01/2020 – 12/2020", NOW), [2020, 2021]);
  assert.deepEqual(cvIntervalOf("2019 – 2021", NOW), [2019, 2021]);
  assert.equal(cvIntervalOf("2024", NOW)![1] - cvIntervalOf("2024", NOW)![0], 1);
  for (const now of ["09/2024 – present", "09/2024 – dosud", "09/2024 – heute", "09/2024 – aujourd'hui"]) {
    const [s, e] = cvIntervalOf(now, NOW)!;
    assert.ok(Math.abs(s - (2024 + 8 / 12)) < 1e-9 && Math.abs(e - (2026 + 8 / 12)) < 1e-9, now);
  }
  assert.equal(cvIntervalOf(null, NOW), null);
  assert.equal(cvIntervalOf("summer", NOW), null);
});

test("years of experience are the union of the roles, an overlap counted once", () => {
  const role = (dates: string | null) => ({ role: "R", org: null, dates, bullets: [], compact: false });
  assert.equal(cvYearsOf({ experience: [role("2018 – 2022"), role("2020 – 2024")] }, NOW), 6);
  assert.equal(cvYearsOf({ experience: [role("2010 – 2012"), role("2020 – 2021")] }, NOW), 3);
  assert.equal(cvYearsOf({ experience: [role(null)] }, NOW), null);
});

test("the budget: one page under three years, two otherwise, two when nothing is dated", () => {
  assert.equal(cvPageBudget(1.5), 1);
  assert.equal(cvPageBudget(3), 2);
  assert.equal(cvPageBudget(null), 2);
});

test("the verdict counts pages, the last page's fill, over-budget and a sparse spill", () => {
  const one = cvPageVerdict(CV_FIRST_PAGE_MM - 40, 2);
  assert.deepEqual([one.pages, one.over, one.sparse], [1, false, false]);
  // Two pages for a two-year CV: over its budget.
  const spill = cvPageVerdict(CV_FIRST_PAGE_MM + 30, 2);
  assert.deepEqual([spill.pages, spill.over, spill.sparse], [2, true, true]);
  assert.ok(Math.abs(spill.lastFill - 30 / CV_NEXT_PAGE_MM) < 1e-9);
  // Two pages, the second over half full, for a ten-year CV: within budget.
  const two = cvPageVerdict(CV_FIRST_PAGE_MM + 180, 10);
  assert.deepEqual([two.pages, two.over, two.sparse], [2, false, false]);
  // Three pages is over any budget.
  assert.equal(cvPageVerdict(CV_FIRST_PAGE_MM + CV_NEXT_PAGE_MM + 100, 12).over, true);
  // A millimetre of rounding past the first page is not a second page.
  assert.equal(cvPageVerdict(CV_FIRST_PAGE_MM + 0.5, 1).pages, 1);
});
