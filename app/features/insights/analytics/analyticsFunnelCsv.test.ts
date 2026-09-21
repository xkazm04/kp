// The funnel export must not know how to fabricate a number.
//
// Two absent cases reach this file and both are load-bearing: a stage with no
// predecessor cohort has no conversion, and a stage with no org-set goal has no
// benchmark. The screen already refuses to invent either (analyticsFunnelEmptyState
// — `stageVerdict` returns "none" and the row stays grey). Pinned here because the
// export outlives the screen: a `0%` written into a board deck is a claim nobody can
// trace back to the reading that produced it.
//
// The round-trip through `toCsv` is asserted too, because the export's other job is
// to be safe to OPEN — a stage label is catalog text today, but every other export on
// this tab carries candidate-controlled strings through the same serializer.
//
// Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyticsCsvProvenance, funnelCsvRows, rolesCsvRows } from "./analyticsFunnelCsv.ts";
import { toCsv } from "@/app/_lib/export-utils";
import type { FunnelRow } from "./analyticsFunnelEmptyState.ts";

const LABELS = { stage: "Stage", reached: "Reached", current: "Here now", conversion: "Conversion", goal: "Goal" };
const upper = (s: string) => s.toUpperCase();

const row = (stage: string, reached: number, current: number, conversionPct: number | null): FunnelRow => ({
  stage,
  reached,
  current,
  conversionPct,
});

test("the header comes first and the stages keep the band's order", () => {
  const rows = funnelCsvRows([row("applied", 40, 12, null), row("screen", 20, 5, 50)], {}, LABELS, upper);
  assert.deepEqual(rows[0], ["Stage", "Reached", "Here now", "Conversion", "Goal"]);
  assert.equal(rows.length, 3);
  assert.equal(rows[1][0], "APPLIED", "the stage label is resolved through the caller's enum lookup, not printed raw");
  assert.equal(rows[2][0], "SCREEN");
});

test("an unmeasurable conversion is a dash, never 0%", () => {
  // The first stage has no predecessor, so `conversionPct` is null — the exact row
  // the band renders as "—".
  const [, first] = funnelCsvRows([row("applied", 40, 12, null)], { applied: 60 }, LABELS, upper);
  assert.equal(first[3], "—");
  assert.notEqual(first[3], "0%");
});

test("a stage with no goal exports no benchmark", () => {
  const [, screen] = funnelCsvRows([row("screen", 20, 5, 50)], {}, LABELS, upper);
  assert.equal(screen[4], "—", "a goal nobody set must not appear as a number in an artifact that gets forwarded");
});

test("a measured conversion and a set goal both carry their unit", () => {
  const [, screen] = funnelCsvRows([row("screen", 20, 5, 50)], { screen: 65 }, LABELS, upper);
  assert.deepEqual(screen, ["SCREEN", 20, 5, "50%", "65%"]);
});

test("counts stay numeric so a spreadsheet can sum them", () => {
  const [, applied] = funnelCsvRows([row("applied", 40, 12, null)], {}, LABELS, upper);
  assert.equal(typeof applied[1], "number");
  assert.equal(typeof applied[2], "number");
});

test("serializes through toCsv with the formula guard intact", () => {
  // A renamed stage is operator text; the same serializer carries candidate names on
  // the sibling exports, so the neutralization must survive this row shape too.
  const csv = toCsv(funnelCsvRows([row("=cmd|calc", 3, 1, 25)], { "=cmd|calc": 40 }, LABELS, (s) => s));
  const [header, first] = csv.split("\r\n");
  assert.equal(header, "Stage,Reached,Here now,Conversion,Goal");
  assert.match(first, /^'=cmd\|calc,3,1,25%,40%$/, "the leading = is neutralized once, in export-utils");
});

const PROV_LABELS = {
  export: "Export",
  generated: "Generated",
  window: "Window",
  tz: "Time zone",
  locale: "Language",
  truncated: "Truncated",
  excludedSim: "Excluded sim",
};

test("funnel CSV provenance names window, UTC, and truncated", () => {
  const provenance = analyticsCsvProvenance(
    "kp-funnel.csv",
    {
      window: "Last 90 days",
      bucketTz: "UTC",
      locale: "en",
      truncated: true,
      excludedSim: 0,
      truncatedNote: "Counted the newest 500 entries, not the whole window.",
      generatedAt: "2026-09-17T12:00:00.000Z",
    },
    PROV_LABELS
  );
  const rows = funnelCsvRows([row("applied", 40, 12, null)], {}, LABELS, upper, { provenance });
  const blob = rows.map((r) => r.join(",")).join("\n");
  assert.match(blob, /Last 90 days/);
  assert.match(blob, /UTC/);
  assert.match(blob, /Counted the newest 500 entries/);
  assert.equal(rows[0][0], "Export");
  assert.equal(rows[rows.length - 2][0], "Stage", "the table header still follows the blank separator");
});

test("roles CSV provenance matches the funnel's scope block", () => {
  const provenance = analyticsCsvProvenance(
    "kp-roles.csv",
    {
      window: "All time",
      bucketTz: "UTC",
      locale: "cs",
      truncated: false,
      excludedSim: 3,
      excludedNote: "3 guided-demo rows left out",
      generatedAt: "2026-09-17T12:00:00.000Z",
    },
    PROV_LABELS
  );
  const rows = rolesCsvRows(
    [{ jobTitle: "Backend", koDeclined: 1, total: 4, reachedInterview: 2, hired: 1, hireRatePct: 25 }],
    {
      job: "Role",
      koDeclined: "KO",
      inPipeline: "Pipeline",
      reachedInterview: "Interview",
      hired: "Hired",
      hireRate: "Hire rate",
    },
    { provenance }
  );
  const blob = rows.map((r) => r.join(",")).join("\n");
  assert.match(blob, /UTC/);
  assert.match(blob, /All time/);
  assert.match(blob, /3 guided-demo rows left out/);
  assert.doesNotMatch(blob, /Truncated/);
  assert.equal(rows[rows.length - 1][5], "25%", "the body still carries the screen's hire-rate unit");
});
