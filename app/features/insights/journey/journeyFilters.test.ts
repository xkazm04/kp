// The filters. The load-bearing one is the last test: a filter must not be able
// to re-base the rail's cohort figures, or "38 of 45" becomes a tautology about
// whatever the reader happens to be looking at.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_JOURNEY_FILTERS,
  columnMatchesFind,
  filterBoard,
  foldForSearch,
  isFiltering,
  rolePickerOptions,
  selectedRole,
  toggleRole,
  withSelectedRole,
} from "./journeyFilters.ts";
import { journeyBoardFixture } from "./__fixtures__/journeyBoard.ts";

test("find folds case AND diacritics — these names are mostly Czech", () => {
  assert.equal(foldForSearch("Veselá"), "vesela");
  assert.equal(foldForSearch("Králová"), "kralova");
  assert.equal(columnMatchesFind({ candidateLabel: "Aneta Veselá", stage: "Interview" }, "vesela"), true);
  assert.equal(columnMatchesFind({ candidateLabel: "Aneta Veselá", stage: "Interview" }, "ANETA"), true);
  assert.equal(columnMatchesFind({ candidateLabel: "Aneta Veselá", stage: "Interview" }, "interview"), true);
  assert.equal(columnMatchesFind({ candidateLabel: "Aneta Veselá", stage: "Interview" }, "petr"), false);
  assert.equal(columnMatchesFind({ candidateLabel: "Aneta Veselá", stage: "Interview" }, ""), true);
});

test("test-run columns are out by default and come back deliberately", () => {
  const out = filterBoard(journeyBoardFixture, EMPTY_JOURNEY_FILTERS);
  assert.equal(
    out.clusters[0].columns.some((c) => c.origin.kind === "test-run"),
    false,
    "a /uat run is real, but it is not live traffic"
  );
  const withRuns = filterBoard(journeyBoardFixture, { ...EMPTY_JOURNEY_FILTERS, testRuns: true });
  assert.equal(withRuns.clusters[0].columns.length, 4);
});

test("active-only and role selection narrow as expected, and empty clusters drop out", () => {
  const active = filterBoard(journeyBoardFixture, { ...EMPTY_JOURNEY_FILTERS, activeOnly: true });
  assert.equal(
    active.clusters[0].columns.some((c) => !c.active),
    false
  );
  const roleB = filterBoard(journeyBoardFixture, { ...EMPTY_JOURNEY_FILTERS, roles: ["job-b"] });
  assert.equal(roleB.clusters.length, 1);
  assert.equal(roleB.clusters[0].jobId, "job-b");
  // A find with no hit leaves no cluster behind rather than an empty frame with
  // a rail and a shared band and nothing under them.
  const nothing = filterBoard(journeyBoardFixture, { ...EMPTY_JOURNEY_FILTERS, find: "zzzz" });
  assert.equal(nothing.clusters.length, 0);
});

test("filtering NEVER rewrites totalColumns — the rail's cohort is the whole role", () => {
  const out = filterBoard(journeyBoardFixture, { ...EMPTY_JOURNEY_FILTERS, activeOnly: true });
  assert.equal(out.clusters[0].totalColumns, 45);
  assert.ok(out.clusters[0].columns.length < 45);
  // And the rail itself is untouched, so "45 of 45" still means the cohort.
  assert.deepEqual(out.clusters[0].rail, journeyBoardFixture.clusters[0].rail);
});

test("toggleRole and isFiltering", () => {
  const one = toggleRole(EMPTY_JOURNEY_FILTERS, "job-a");
  assert.deepEqual(one.roles, ["job-a"]);
  assert.deepEqual(toggleRole(one, "job-a").roles, []);
  assert.equal(isFiltering(EMPTY_JOURNEY_FILTERS), false);
  assert.equal(isFiltering({ ...EMPTY_JOURNEY_FILTERS, find: "   " }), false, "whitespace is not a search");
  assert.equal(isFiltering({ ...EMPTY_JOURNEY_FILTERS, observedOnly: true }), true);
});

// `roleArea` arrives as a canonical slug; the picker heads each group with the
// localized label and degrades to the slug when the taxonomy has no word for it.
const LABELS = {
  allRoles: "All roles",
  ungrouped: "Other roles",
  areaLabel: (slug: string) => (slug === "software_engineering" ? "Engineering" : slug),
  collator: new Intl.Collator("en", { numeric: true }),
};

test("the role picker groups by area, sorts both levels, and never invents a bucket", () => {
  const options = rolePickerOptions(
    [
      { jobId: "j1", title: "Zebra Handler", roleArea: "operations" },
      { jobId: "j2", title: "Backend Engineer", roleArea: "software_engineering" },
      { jobId: "j3", title: "Analyst", roleArea: null },
      { jobId: "j4", title: "Android Engineer", roleArea: "software_engineering" },
      // An EMPTY area is the same fact as a missing one — the record does not
      // say — and must not become a group whose name is "".
      { jobId: "j5", title: "Barista", roleArea: "   " },
    ],
    LABELS
  );

  assert.deepEqual(
    options.map((o) => o.label),
    [
      "All roles",
      // Sorted by the LABEL ("Engineering"), not by the slug it came from
      // ("software_engineering"), which would have filed it after "operations".
      "Engineering",
      "Android Engineer",
      "Backend Engineer",
      "operations",
      "Zebra Handler",
      "Other roles",
      "Analyst",
      "Barista",
    ]
  );
  // Headings are not choosable; "All roles" is.
  assert.deepEqual(
    options.filter((o) => o.disabled === true).map((o) => o.label),
    ["Engineering", "operations", "Other roles"]
  );
  assert.equal(options[0].value, "");
  assert.equal(options[0].disabled, undefined);
});

test("a board with no areas at all is still one honest group", () => {
  const options = rolePickerOptions([{ jobId: "j1", title: "Analyst", roleArea: null }], LABELS);
  assert.deepEqual(options.map((o) => o.label), ["All roles", "Other roles", "Analyst"]);
  // And a board with no roles is just the one option, never an empty dropdown.
  assert.deepEqual(rolePickerOptions([], LABELS).length, 1);
});

test("the picker is single-select over a set-shaped filter, and back", () => {
  assert.equal(selectedRole(EMPTY_JOURNEY_FILTERS), "");
  const picked = withSelectedRole(EMPTY_JOURNEY_FILTERS, "job-a");
  assert.deepEqual(picked.roles, ["job-a"]);
  assert.equal(selectedRole(picked), "job-a");
  // Back to "all roles" is an EMPTY list, which is what filterBoard reads as
  // "do not narrow" — not a list holding the empty string.
  assert.deepEqual(withSelectedRole(picked, "").roles, []);
  assert.equal(isFiltering(withSelectedRole(picked, "")), false);
});
