// Analyze reservation gate — cross-tenant isolation (Direction 3, P2 tenancy arc).
//
// The bug this pins: the gate that counts in-flight analyze reservations used to read
// EVERY tenant's analyze tasks (rows stamped under the default workspace) against the
// single global meter, so one tenant's burst reserved against — and could block —
// another tenant's quota. The fix stamps each analyze task with its requesting
// workspace and scopes the in-flight count (and the meter read) to that workspace.
//
// Two-part proof, mirroring the repo convention (the route imports via "@/" which the
// bare runner can't resolve, and the store needs SQLite):
//   (a) a SOURCE guard that the route wires the workspace into the count, the meter
//       read, and the task-row stamp; and
//   (b) a BEHAVIORAL drive of the REAL tasks store on a throwaway SQLite file, proving
//       tenant B's in-flight analyze rows don't appear in tenant A's reservation count.
//
//   npm run test:unit
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Same minimal resolve hook as billing-reserve.test.ts (extensionless TS siblings +
// "@/" alias) so this file loads even when run without the package.json --import loader.
const ROOT = new URL("../../../", import.meta.url).href; // repo root (app/api/analyze/ -> ../../../)
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    const fromOurCode = context.parentURL && !context.parentURL.includes("node_modules");
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), ROOT).href;
    else if ((spec.startsWith("./") || spec.startsWith("../")) && fromOurCode) {
      spec = new URL(spec, context.parentURL!).href;
    }
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && fs.existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts";
    }
    return nextResolve(spec, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      const source = "export default " + fs.readFileSync(fileURLToPath(url), "utf8") + ";";
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// ── (a) Source guard: the door wires the workspace through the whole gate ───────
// The single-CV door (POST /api/analyze) was retired on 2026-11-10; the cohort door is
// the one that spends ai_candidates units now, so the guard reads it.
test("the cohort door scopes the in-flight count, the meter read, and the task stamp per workspace", () => {
  const src = readFileSync(fileURLToPath(new URL("./cohort/route.ts", import.meta.url)), "utf8");
  // The in-flight reservation count is scoped to the requesting workspace (3rd arg).
  assert.match(
    src,
    /listRecentTasks\(new Date\(\)\.toISOString\(\),\s*200,\s*ws\)/,
    "the in-flight count must pass the workspace to listRecentTasks",
  );
  // The authoritative reservation reads the meter for that workspace.
  assert.match(
    src,
    /meterGate\("ai_candidates",\s*\{\s*workspace:\s*ws,[^}]*inFlight\s*\}\)/,
    "the reservation gate must scope the meter read to the workspace",
  );
  // The task row is stamped with the workspace so its reservation counts for the right tenant.
  assert.match(src, /startTask\("analyze_cohort",[^)]*\},\s*ws\)/, "startTask must stamp the task with the workspace");
});

// ── (b) Behavioral: prove the count is genuinely per-tenant on the real store ────
// Throwaway DB BEFORE importing (db-path reads KP_DB_PATH at module load), so this MUST
// stay the first project import.
//
// It used to be a hand-rolled `os.tmpdir()/kp-analyze-gate-tenancy-test-${process.pid}.sqlite`
// that was never deleted. `--test-isolation=process` gives each FILE a fresh process, but the
// OS RECYCLES pids: a later run drawing a pid this file had used before re-opened that run's
// leftover database and inherited its committed task rows, inflating the per-tenant in-flight
// counts this file asserts exactly. unit-db.ts is the repo-wide fix: a mkdtemp'd run directory
// (unique by construction, never pid-derived), a liveness-gated sweep of abandoned dirs, and
// cleanupUnitDb() to remove our own.
const { cleanupUnitDb } = await import("../../_lib/testing/unit-db.ts");
after(cleanupUnitDb);

const { createTask, getTask, listRecentTasks, DEFAULT_WORKSPACE_ID } = await import("../../_lib/db.ts");

const { inFlightCandidateUnits } = await import("./in-flight-units.ts");

// The EXACT expression the route uses to count in-flight reservations for a tenant, so the
// test drives the real count (the shared helper), not a paraphrase.
function inFlightAnalyzeFor(workspace: string): number {
  return inFlightCandidateUnits(listRecentTasks(new Date().toISOString(), 200, workspace), (id) => getTask(id, workspace)?.params);
}

test("tenant B's in-flight analyze runs don't count against tenant A's gate", () => {
  const A = DEFAULT_WORKSPACE_ID; // the single-tenant default
  const B = "team-b";

  // Tenant A has one queued analyze run.
  createTask("t-a1", "analyze", "analyze:a1", "Analyze · A", { variants: [] }, A);
  // Tenant B fires a burst of three.
  createTask("t-b1", "analyze", "analyze:b1", "Analyze · B1", { variants: [] }, B);
  createTask("t-b2", "analyze", "analyze:b2", "Analyze · B2", { variants: [] }, B);
  createTask("t-b3", "analyze", "analyze:b3", "Analyze · B3", { variants: [] }, B);
  // A non-analyze task under A must never inflate the analyze reservation count.
  createTask("t-a-other", "reasoning", "reasoning:a", "Why · A", {}, A);

  // A sees only its OWN one analyze reservation — B's three are invisible to it.
  assert.equal(inFlightAnalyzeFor(A), 1, "tenant A's gate counts only tenant A's analyze runs");
  // B sees its own three.
  assert.equal(inFlightAnalyzeFor(B), 3, "tenant B's gate counts only tenant B's analyze runs");

  // The pre-fix behavior (all rows under the default workspace) would have made A's
  // count 4 — enough of B's burst to exhaust a small cap and block A. Scoping fixes it.
});

test("an in-flight cohort's declared fresh units count at the analyze door too", () => {
  const C = "team-c";
  createTask("t-c1", "analyze", "analyze:c1", "Analyze · C", { variants: [] }, C);
  createTask("t-c-cohort", "analyze_cohort", "analyze_cohort:c", "Cohort · C", { cohortId: "coh-c", freshCount: 4 }, C);
  // A cohort that reuses everyone declares 0 and reserves nothing.
  createTask("t-c-reused", "analyze_cohort", "analyze_cohort:c2", "Cohort · C2", { cohortId: "coh-c2", freshCount: 0 }, C);
  assert.equal(inFlightAnalyzeFor(C), 5, "one analyze task + the cohort's four fresh units");
  // The door counts through the one helper (no second copy of the rule to drift).
  for (const rel of ["./cohort/route.ts"]) {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    assert.match(src, /inFlightCandidateUnits\(listRecentTasks\(/, `${rel} counts through inFlightCandidateUnits`);
  }
});
