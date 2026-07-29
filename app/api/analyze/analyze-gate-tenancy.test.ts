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

// ── (a) Source guard: the route wires the workspace through the whole gate ──────
test("analyze route scopes the in-flight count, the meter read, and the task stamp per workspace", () => {
  const src = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");
  // The requesting workspace is resolved once and reused.
  assert.match(src, /const workspace = await currentWorkspace\(\)/, "must resolve the requesting workspace");
  // The in-flight reservation count is scoped to that workspace (3rd arg to listRecentTasks).
  assert.match(
    src,
    /listRecentTasks\(new Date\(\)\.toISOString\(\),\s*200,\s*workspace\)/,
    "the in-flight count must pass `workspace` to listRecentTasks",
  );
  // The authoritative reservation reads the meter for that workspace.
  assert.match(
    src,
    /meterGate\("ai_candidates",\s*\{\s*inFlight:\s*inFlightAnalyze,\s*workspace\s*\}\)/,
    "the reservation gate must scope the meter read to `workspace`",
  );
  // The cheap pre-check is scoped too, so an early refusal reads the same tenant.
  assert.match(src, /meterGate\("ai_candidates",\s*\{\s*workspace\s*\}\)/, "the pre-check must scope to `workspace`");
  // The task row is stamped with the workspace so its reservation counts for the right tenant.
  assert.match(src, /startTask\("analyze",[^)]*,\s*workspace\)/, "startTask must stamp the task with `workspace`");
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

const { createTask, listRecentTasks, DEFAULT_WORKSPACE_ID } = await import("../../_lib/db.ts");

// The EXACT expression the route uses to count in-flight analyze reservations for a
// tenant — kept in lockstep here so the test drives the real filter, not a paraphrase.
function inFlightAnalyzeFor(workspace: string): number {
  return listRecentTasks(new Date().toISOString(), 200, workspace).filter(
    (t) => t.kind === "analyze" && (t.status === "queued" || t.status === "running"),
  ).length;
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
