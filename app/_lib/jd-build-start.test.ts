// The `jd_build` start seam: a SOURCE GUARD that keeps it the only door, plus the
// contract of the seam itself.
//
// Starting a build is a three-step, spend-bearing sequence (placeholder row →
// detached task stamped with the SAME workspace → row↔task link). Four callers
// hand-rolled it, and a rule that lands on three of four copies is worse than no
// rule: that is exactly how the tenant stamp went missing once (the JD row was
// created for the right team while its matchable opening went to the default one),
// and it is how the per-IP throttles would have gone missing next.
//
// Read as SOURCE, never driven: `startTask` pumps the queue synchronously, so
// actually calling the seam in a unit test would spawn a real 1–2 minute AI build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEAM = path.join("_lib", "jd-build-start.ts");
// Line endings normalised — a checkout with core.autocrlf=true carries CRLF, and a
// marker that spans a newline would never match (the same trap rate-limit-contract
// documents).
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

// --- the seam's own contract ------------------------------------------------

test("startJdBuild owns title / jdSlug / options — a caller's params cannot steer them", () => {
  const src = read(SEAM);
  const at = src.indexOf('startTask(\n    "jd_build"');
  assert.ok(at > 0, "expected the single startTask call");
  const call = src.slice(at, at + 300);
  // The spread comes FIRST, so the seam's own three keys overwrite anything a caller
  // sent: a task pointed at another row (jdSlug) or carrying a different checklist
  // than the row it just created (options) is the drift this seam exists to prevent.
  assert.match(call, /\{ \.\.\.input\.params, title: input\.title, jdSlug: slug, options: input\.options \}/);
  assert.match(call, /input\.workspaceId/, "the task must be stamped with the row's tenant");
});

test("both entry points link the row to its task, or the Ledger shows no progress", () => {
  const src = read(SEAM);
  assert.equal(src.match(/setJdAnalysisTask\(slug, task\.id\)/g)?.length, 2);
  // A retry must reset the row BEFORE the replay is queued, so the Ledger reflects
  // the re-run immediately instead of keeping the failed chip until the build lands.
  const reset = src.indexOf("markJdAnalyzing(slug)");
  const replay = src.indexOf('startTask("jd_build"');
  assert.ok(reset > 0 && replay > reset, "markJdAnalyzing must precede the replay");
});

// --- the source guard -------------------------------------------------------
//
// Any file pairing `insertAnalyzingJd(` with `startTask("jd_build"` starts a build
// outside the seam — and therefore outside its tenant stamp and outside the
// throttles the route doors carry.
//
// ALLOW-LIST: empty, and it stays that way. It briefly held
// app/api/intake/[id]/promote/route.ts, the fourth hand-rolled copy of the start
// sequence; that route moved onto the seam in the same wave and the entry went with
// it. A new door is routed through `startJdBuild()`, never added here.
const ALLOWED: string[] = [];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if ((name.endsWith(".ts") || name.endsWith(".tsx")) && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

test("no file starts a jd_build outside app/_lib/jd-build-start.ts", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(ROOT)) {
    const rel = path.relative(ROOT, file);
    if (rel === SEAM || ALLOWED.includes(rel)) continue;
    const src = readFileSync(file, "utf8");
    if (src.includes("insertAnalyzingJd(") && /startTask\(\s*"jd_build"/.test(src)) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `these files hand-roll the jd_build start sequence — route them through startJdBuild():\n${offenders.join("\n")}`,
  );
});

test("all four doors go through the seam", () => {
  for (const rel of [
    path.join("api", "jds", "generate", "route.ts"),
    path.join("api", "jds", "[slug]", "retry-analysis", "route.ts"),
    path.join("_lib", "companion-actions.ts"),
    // The last convert: promote used to interleave `markIntakePromoted` with the
    // three steps, which is why it was allow-listed rather than converted first.
    path.join("api", "intake", "[id]", "promote", "route.ts"),
  ]) {
    const src = read(rel);
    assert.match(src, /jd-build-start/, `${rel}: must import the seam`);
    assert.doesNotMatch(src, /startTask\(\s*"jd_build"/, `${rel}: must not start a jd_build itself`);
  }
});
