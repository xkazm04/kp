// The null-score policy helpers (REC-03 / SD-L1-002) — pure, DB-free — plus the
// source-level fabrication guard (kp convention: a regex test over the sources,
// like the tenancy guards) that keeps the `matchScore ?? 0` idiom from ever
// re-entering the app: coercing an ABSENT match score to 0 is how a never-scored
// candidate got auto-rejected on a fabricated number and sealed as "match 0".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { compareByMatchScoreDesc, compareScoreDesc, isScored } from "./match-score.ts";

test("compareScoreDesc ranks best-first and sinks unscored strictly below every measurement — including a genuine 0", () => {
  const sorted = [55, null, 0, 90, undefined, 12].sort(compareScoreDesc);
  assert.deepEqual(sorted, [90, 55, 12, 0, null, undefined]);
});

test("an unscored value never ties with or beats a genuine 0 (the exact conflation the old `?? 0` created)", () => {
  assert.ok(compareScoreDesc(0, null) < 0, "genuine 0 ranks above null");
  assert.ok(compareScoreDesc(null, 0) > 0, "null ranks below genuine 0");
  assert.equal(compareScoreDesc(null, undefined), 0, "two absent scores are equal (stable sort keeps input order)");
});

test("compareByMatchScoreDesc + isScored partition a cohort without fabricating", () => {
  const cohort = [
    { id: "a", matchScore: 40 },
    { id: "b", matchScore: null },
    { id: "c", matchScore: 0 },
    { id: "d", matchScore: 87 },
  ];
  assert.deepEqual([...cohort].sort(compareByMatchScoreDesc).map((e) => e.id), ["d", "a", "c", "b"]);
  const scored = cohort.filter(isScored);
  assert.deepEqual(scored.map((e) => e.id), ["a", "c", "d"]);
  // The type guard narrows: every survivor carries a real number.
  assert.ok(scored.every((e) => typeof e.matchScore === "number"));
});

// ---- Source guard: no decision-feeding `matchScore ?? 0` site may remain -----
//
// REC-03 inventoried seven such sites (screen-wave sort/stats/threshold/seal,
// group-eval cap + score column, advance-top-N, the sim's "best" pick). All are
// fixed to the null-safe helpers above; this walk fails CI if the idiom returns
// anywhere in app/ source. Display components that need a *rendering* fallback
// use an explicit dash (`?? "—"`) or a null-guarded branch instead — an absent
// score may be shown as absent, but never minted into a number.

const APP_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

test("no `matchScore ?? 0` fabrication site remains anywhere under app/", () => {
  const files = walk(APP_ROOT);
  // Sanity: the walk really covers the decision layer this guard exists for.
  for (const mustSee of ["screen-wave.ts", "group-eval-run.ts", path.join("command", "route.ts"), "SimulationProvider.tsx"]) {
    assert.ok(files.some((f) => f.endsWith(mustSee)), `guard walk must cover ${mustSee}`);
  }
  const offenders = files.filter((f) => /matchScore\s*\?\?\s*0(?![.\d])/.test(readFileSync(f, "utf8")));
  assert.deepEqual(
    offenders.map((f) => path.relative(APP_ROOT, f)),
    [],
    "an absent match score must stay null (see app/_lib/match-score.ts) — never be coerced to a decision-feeding 0"
  );
});
