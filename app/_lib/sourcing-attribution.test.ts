// Sourcing channel attribution — THE MODEL IS FIRST-TOUCH, IMMUTABLE AT INTAKE.
//
// That name had never been written down, here or in the analytics doc, even though
// every per-source / per-channel / per-creative figure on the Economics board rests
// on it. Stated once: an entry's source_channel (and source_campaign /
// source_variant beside it) is stamped ONCE, by whichever door the candidate first
// arrived through, and NOTHING relabels it afterwards. No last-touch override, no
// multi-touch weighting, no decay. The board therefore answers "which door did this
// person come in through?", never "which touch converted them?" — a campaign that
// re-engaged a candidate sourced elsewhere earns no credit here BY CONSTRUCTION, and
// the two tests below are what make that true rather than aspirational.
//
// (Immutability is not a policy check anywhere; it is a property of the write path —
// the re-add is idempotent, so there is no second write to relabel with. Anything
// that later adds a genuine re-attribution path has to break test 2 to do it, which
// is the point.) See docs/features/analytics/README.md § Economics.
//
// The reach-out route now persists an
// honest source_channel on the entry it mints for a rediscovered/sourced candidate
// (was null). This pins the two load-bearing db-level guarantees the route relies on:
//   1. sourceChannel round-trips through createPipelineEntry onto the entry (→ the
//      drawer's "via" line + the board source facet read it).
//   2. a re-add is idempotent AND never RELABELS an existing entry's source — a
//      second reach-out/click can't rewrite the earlier attribution.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../", import.meta.url).href; // repo root (app/_lib/ -> ../../)
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), ROOT).href;
    else if (
      (spec.startsWith("./") || spec.startsWith("../")) &&
      context.parentURL &&
      !context.parentURL.includes("node_modules")
    ) {
      spec = new URL(spec, context.parentURL).href;
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

// Point every store connection at a throwaway DB BEFORE importing them: db-path reads
// KP_DB_PATH at module load (DB_PATH is frozen then), so this MUST stay the first
// project import.
//
// It used to be a hand-rolled `os.tmpdir()/kp-sourcing-attribution-${process.pid}.sqlite`.
// `--test-isolation=process` gives each FILE a fresh process, but the OS RECYCLES pids:
// a later run drawing a pid this file used before re-opens that run's leftover database
// and inherits its committed entries (see 7c63692, the billing-suite flake). unit-db.ts is the
// repo-wide fix: a mkdtemp'd run directory (unique by construction, never pid-derived),
// a liveness-gated sweep of abandoned dirs, and cleanupUnitDb().
const { cleanupUnitDb } = await import("./testing/unit-db.ts");

const { createPipelineEntry } = await import("./db.ts");

// Closes the memoized main connection and removes this run's temp dir; a still-open
// isolated handle only means the fixture's sweep reclaims the dir on a later run.
after(cleanupUnitDb);

test("a reach-out add persists an honest source_channel that round-trips onto the entry", () => {
  const { entry, created } = createPipelineEntry({
    candidateId: "cand-src",
    candidateLabel: "Cand Src",
    jobId: "jobSrc",
    jobTitle: "Sourced Role",
    stage: "Screened",
    sourceChannel: "sourcing",
  });
  assert.equal(created, true);
  assert.equal(entry.sourceChannel, "sourcing");
});

test("a re-add is idempotent and NEVER relabels the existing entry's source", () => {
  // Second click (or the add button after a reach-out) with a DIFFERENT source.
  const { entry, created } = createPipelineEntry({
    candidateId: "cand-src",
    candidateLabel: "Cand Src",
    jobId: "jobSrc",
    jobTitle: "Sourced Role",
    stage: "Screened",
    sourceChannel: "rediscovery",
  });
  assert.equal(created, false); // existing row returned, not a duplicate
  assert.equal(entry.sourceChannel, "sourcing"); // original attribution preserved
});
