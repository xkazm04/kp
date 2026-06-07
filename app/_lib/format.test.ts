// Locks the timestamp contract behind the relative "x ago" renderer: every
// audit/outcome/task timestamp the app renders is ISO-8601 UTC with an explicit
// designator (`...Z` or a numeric offset). The whole compliance story rests on
// accurate "when did this happen" ages, and a *naive* (zone-less) string —
// SQLite's `YYYY-MM-DD HH:MM:SS`, say — is read by Date.parse as LOCAL time, so
// the age silently shifts by the viewer's UTC offset. These tests pin the
// classifier that draws that line and assert the renderer reports a violation
// instead of swallowing the skew.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertFraction,
  assertScore,
  classifyTimestamp,
  clampFraction,
  formatFraction,
  formatRelativeTime,
  RATING_MAX,
  ratingToPercent,
  ratingTone,
  reconcileScoreTotal,
  scoreComponentSum,
  SCORE_COMPONENT_KEYS,
} from "./format.ts";

// --- classifyTimestamp: the pure contract logic, host-TZ independent --------

test("classifyTimestamp labels blank input empty", () => {
  assert.equal(classifyTimestamp(""), "empty");
  assert.equal(classifyTimestamp("   "), "empty");
});

test("classifyTimestamp labels a Z-suffixed timestamp utc (the canonical mint)", () => {
  // new Date().toISOString() always emits this shape.
  assert.equal(classifyTimestamp("2026-06-03T10:33:40Z"), "utc");
  assert.equal(classifyTimestamp("2026-06-03T10:33:40.123Z"), "utc");
});

test("classifyTimestamp accepts an explicit numeric offset as utc (unambiguous instant)", () => {
  assert.equal(classifyTimestamp("2026-06-03T10:33:40+02:00"), "utc");
  assert.equal(classifyTimestamp("2026-06-03T10:33:40-0500"), "utc");
});

test("classifyTimestamp labels a zone-less datetime naive (the skew case)", () => {
  // A clock time with no Z/offset — Date.parse reads it as LOCAL time.
  assert.equal(classifyTimestamp("2026-06-03T10:33:40"), "naive");
  assert.equal(classifyTimestamp("2026-06-03T10:33"), "naive");
  // SQLite's space-separated CURRENT_TIMESTAMP shape, the exact failure the
  // requirement calls out.
  assert.equal(classifyTimestamp("2026-06-03 10:33:40"), "naive");
});

test("classifyTimestamp treats a date-only value as utc (the spec parses it as UTC)", () => {
  // No clock time → Date.parse uses UTC midnight, so it isn't skew-prone.
  assert.equal(classifyTimestamp("2026-06-03"), "utc");
});

test("classifyTimestamp labels garbage unparseable", () => {
  assert.equal(classifyTimestamp("not a date"), "unparseable");
  assert.equal(classifyTimestamp("2026-13-99T99:99:99Z"), "unparseable");
});

// --- formatRelativeTime: bucketing + the future clamp -----------------------

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

test("formatRelativeTime buckets seconds, minutes, hours, and days", () => {
  assert.equal(formatRelativeTime(ago(30_000)), "30s ago");
  assert.equal(formatRelativeTime(ago(90_000)), "1m ago");
  assert.equal(formatRelativeTime(ago(3 * 3_600_000)), "3h ago");
  assert.equal(formatRelativeTime(ago(2 * 86_400_000)), "2d ago");
});

test("formatRelativeTime clamps a future timestamp to 0s ago (no negative ages)", () => {
  const future = new Date(Date.now() + 60 * 60_000).toISOString(); // 1h ahead
  assert.equal(formatRelativeTime(future), "0s ago");
});

test("formatRelativeTime returns empty string for blank or unparseable input", () => {
  assert.equal(formatRelativeTime(""), "");
  assert.equal(formatRelativeTime("not a date"), "");
});

// --- the contract assertion: warns on violations, stays quiet otherwise -----

function captureContractWarnings(fn: () => void): string[] {
  const original = console.warn;
  const lines: string[] = [];
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return lines.filter((l) => l.includes("[timestamp-contract]"));
}

// Each warning test uses a unique, safely-past value so the renderer's
// once-per-message dedup (and the future-skew warning) don't cross-contaminate.

test("formatRelativeTime warns once on a naive (zone-less) timestamp", () => {
  const warnings = captureContractWarnings(() => formatRelativeTime("2020-01-02T03:04:05"));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /naive/);
});

test("formatRelativeTime warns on an unparseable timestamp", () => {
  const warnings = captureContractWarnings(() => formatRelativeTime("totally-not-a-timestamp"));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /unparseable/);
});

test("formatRelativeTime stays quiet on a contract-compliant UTC timestamp", () => {
  const warnings = captureContractWarnings(() => formatRelativeTime("2020-03-04T05:06:07Z"));
  assert.equal(warnings.length, 0);
});

test("formatRelativeTime warns on a far-future timestamp (clock/zone skew)", () => {
  const future = new Date(Date.now() + 6 * 3_600_000).toISOString(); // 6h ahead
  const warnings = captureContractWarnings(() => formatRelativeTime(future));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /future/);
});

test("formatRelativeTime dedups repeat warnings for the same bad value", () => {
  // The control room re-renders the same audit rows every 3s; one bad row must
  // warn once, not once per poll.
  const warnings = captureContractWarnings(() => {
    formatRelativeTime("2020-05-06T07:08:09");
    formatRelativeTime("2020-05-06T07:08:09");
    formatRelativeTime("2020-05-06T07:08:09");
  });
  assert.equal(warnings.length, 1);
});

// --- the scorecard rubric scale: rating -> percent -> shared score tone -------
// Single-sources the 1..RATING_MAX rubric scale and its projection onto the
// app-wide 0-100 score scale, so a scorecard rating colors identically to every
// other score (the transcript modal, the Decisions card, and the compare grid
// all read this) and re-gearing the rubric is a one-line edit.

test("ratingToPercent projects 1..RATING_MAX onto 0-100, with the max mapping to 100", () => {
  assert.equal(ratingToPercent(RATING_MAX), 100);
  assert.equal(ratingToPercent(1), (1 / RATING_MAX) * 100);
  // The exact conversion that used to be inlined as `(rating / 5) * 100`.
  assert.equal(ratingToPercent(4), 80);
  assert.equal(ratingToPercent(3), 60);
});

test("ratingTone reads 4-5 strong, 3 mid, and 1-2 weak on the shared score scale", () => {
  assert.equal(ratingTone(5), "strong");
  assert.equal(ratingTone(4), "strong");
  assert.equal(ratingTone(3), "mid");
  assert.equal(ratingTone(2), "weak");
  assert.equal(ratingTone(1), "weak");
});

// --- the score-breakdown invariant: total === sum of components --------------
// ScoreDial paints `total` on its arc while FactorChart plots the five
// components; nothing in the pipeline guarantees they agree, so a bad generation
// could show an 82 dial above bars that add to 74. reconcileScoreTotal makes the
// component sum authoritative for display and reports the divergence once.

// Build a score with explicit components; `total` defaults to the honest sum so
// each test only has to override it to manufacture a divergence.
function mkScore(
  parts: Partial<Record<(typeof SCORE_COMPONENT_KEYS)[number], number>>,
  total?: number
) {
  const components = {
    experience: 0,
    skills: 0,
    roleSeniority: 0,
    education: 0,
    traits: 0,
    ...parts,
  };
  const sum = SCORE_COMPONENT_KEYS.reduce((acc, key) => acc + components[key], 0);
  return { ...components, total: total ?? sum };
}

function captureScoreWarnings(fn: () => void): string[] {
  const original = console.warn;
  const lines: string[] = [];
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return lines.filter((l) => l.includes("[score-contract]"));
}

test("SCORE_COMPONENT_KEYS is the canonical five, in render order", () => {
  assert.deepEqual([...SCORE_COMPONENT_KEYS], [
    "experience",
    "skills",
    "roleSeniority",
    "education",
    "traits",
  ]);
});

test("scoreComponentSum adds the five components (matches what the bars show)", () => {
  assert.equal(
    scoreComponentSum(mkScore({ experience: 20, skills: 25, roleSeniority: 18, education: 8, traits: 7 })),
    78
  );
});

test("scoreComponentSum treats a non-finite component as 0 (no NaN poisoning)", () => {
  assert.equal(
    scoreComponentSum({ experience: 10, skills: NaN, roleSeniority: 5, education: 0, traits: 0 }),
    15
  );
});

test("reconcileScoreTotal returns the component sum and stays quiet when total agrees", () => {
  const score = mkScore({ experience: 21, skills: 24, roleSeniority: 17, education: 9, traits: 6 }); // sum 77, total 77
  const warnings = captureScoreWarnings(() => {
    assert.equal(reconcileScoreTotal(score), 77);
  });
  assert.equal(warnings.length, 0);
});

test("reconcileScoreTotal recomputes to the component sum when total disagrees, warning once", () => {
  // Dial would read 82, but the bars add to 74 — the exact recruiter-facing
  // contradiction the invariant bans. The displayed value is pinned to 74.
  const score = mkScore({ experience: 20, skills: 22, roleSeniority: 18, education: 8, traits: 6 }, 82); // sum 74
  const warnings = captureScoreWarnings(() => {
    assert.equal(reconcileScoreTotal(score), 74);
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /82/);
  assert.match(warnings[0], /74/);
});

test("reconcileScoreTotal dedups repeat warnings for the same divergent score", () => {
  // ResultPanel's on-load assert and ExtractionTab's dial both run this for the
  // same analysis; one bad score must warn once, not once per render.
  const score = mkScore({ experience: 19, skills: 23, roleSeniority: 15, education: 7, traits: 5 }, 90); // sum 69
  const warnings = captureScoreWarnings(() => {
    reconcileScoreTotal(score);
    reconcileScoreTotal(score);
    reconcileScoreTotal(score);
  });
  assert.equal(warnings.length, 1);
});

test("dropping the zone shifts the rendered age unless the host runs in UTC", () => {
  // The contract's reason to exist, demonstrated end-to-end: the SAME wall-clock
  // text with and without the trailing Z renders the same age only when the host
  // is UTC; otherwise Date.parse reads the naive form as local time and the age
  // moves by the offset — the silent skew the contract bans.
  const d = new Date(Date.now() - 30_000); // 30s ago, mid-"seconds" bucket
  const zoned = d.toISOString(); // ...Z
  const naive = zoned.slice(0, -1); // drop the trailing Z
  if (d.getTimezoneOffset() === 0) {
    assert.equal(formatRelativeTime(naive), formatRelativeTime(zoned));
  } else {
    assert.notEqual(formatRelativeTime(naive), formatRelativeTime(zoned));
  }
});

// --- the numeric-range contract: fractions (0..1) vs scores (0..100) ----------
// Confidence / fluency / readBeforeWrite / rubric weight / language share are
// 0..1 fractions rendered as percents; capability scores and transferScore are
// 0..100. Nothing on the JSON wire from the Python evaluator enforces it, so a
// unit-swap (a confidence emitted as 85, not 0.85) would render "8500%" on a
// hiring screen. These guards catch the swap at the render boundary: clamp for a
// safe render and report it once. Each warning test uses a UNIQUE value/label so
// the module-level once-per-message dedup doesn't cross-contaminate across tests.

function captureRangeWarnings(fn: () => void): string[] {
  const original = console.warn;
  const lines: string[] = [];
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return lines.filter((l) => l.includes("[range-contract]"));
}

test("clampFraction bounds a value to [0, 1]", () => {
  assert.equal(clampFraction(0.5), 0.5);
  assert.equal(clampFraction(1.4), 1);
  assert.equal(clampFraction(-0.2), 0);
});

test("formatFraction renders an in-range 0..1 fraction as a percent, quietly", () => {
  const warnings = captureRangeWarnings(() => {
    assert.equal(formatFraction(0.73), "73%");
    assert.equal(formatFraction(0), "0%");
    assert.equal(formatFraction(1), "100%");
  });
  assert.equal(warnings.length, 0);
});

test("formatFraction honors the digits option", () => {
  assert.equal(formatFraction(0.736, { digits: 1 }), "73.6%");
});

test("formatFraction catches a 0..100 score fed as a fraction — '100%', not '8500%'", () => {
  // The exact failure the contract bans: a Python evaluator emitting confidence on
  // the 0..100 scale instead of 0..1. Without the guard, formatPercent scales 85 to
  // "8500%" on a recruiter's screen; with it, the swap is reported and clamped.
  const warnings = captureRangeWarnings(() => {
    assert.equal(formatFraction(85, { label: "confidence" }), "100%");
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /confidence/);
  assert.match(warnings[0], /0\.\.1/);
  assert.match(warnings[0], /8500%/);
});

test("assertFraction passes an in-range value through untouched and quiet", () => {
  const warnings = captureRangeWarnings(() => {
    assert.equal(assertFraction(0.42, "share"), 0.42);
    assert.equal(assertFraction(0, "share"), 0);
    assert.equal(assertFraction(1, "share"), 1);
  });
  assert.equal(warnings.length, 0);
});

test("assertFraction clamps an above-range value to 1 and warns once", () => {
  const warnings = captureRangeWarnings(() => {
    assert.equal(assertFraction(42, "fluency"), 1);
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /fluency/);
});

test("assertFraction clamps a below-range value to 0 and warns once", () => {
  const warnings = captureRangeWarnings(() => {
    assert.equal(assertFraction(-0.5, "weight"), 0);
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /weight/);
});

test("assertFraction collapses a non-finite value to 0 without warning", () => {
  const warnings = captureRangeWarnings(() => {
    assert.equal(assertFraction(NaN, "nanFrac"), 0);
    assert.equal(assertFraction(Infinity, "infFrac"), 0);
  });
  assert.equal(warnings.length, 0);
});

test("assertFraction dedups repeat warnings for the same bad value", () => {
  // EvalPanel re-renders the same bundle on every poll; one bad value must warn
  // once, not once per render.
  const warnings = captureRangeWarnings(() => {
    assertFraction(7.5, "dedupFrac");
    assertFraction(7.5, "dedupFrac");
    assertFraction(7.5, "dedupFrac");
  });
  assert.equal(warnings.length, 1);
});

test("assertScore passes an in-range 0..100 score through untouched and quiet", () => {
  const warnings = captureRangeWarnings(() => {
    assert.equal(assertScore(73, "dimScore"), 73);
    assert.equal(assertScore(0, "dimScore"), 0);
    assert.equal(assertScore(100, "dimScore"), 100);
  });
  assert.equal(warnings.length, 0);
});

test("assertScore clamps an above-range score to 100 and warns once", () => {
  // A double-scaled score (850) would otherwise paint a bar overflowing to 850%.
  const warnings = captureRangeWarnings(() => {
    assert.equal(assertScore(850, "capability score"), 100);
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /capability score/);
  assert.match(warnings[0], /0\.\.100/);
});

test("assertScore clamps a negative score to 0 and warns once", () => {
  const warnings = captureRangeWarnings(() => {
    assert.equal(assertScore(-7, "transferScore"), 0);
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /transferScore/);
});

test("assertScore collapses a non-finite score to 0 without warning", () => {
  const warnings = captureRangeWarnings(() => {
    assert.equal(assertScore(NaN, "nanScore"), 0);
  });
  assert.equal(warnings.length, 0);
});
