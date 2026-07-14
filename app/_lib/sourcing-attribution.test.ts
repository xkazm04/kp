// Sourcing channel attribution (direction 2). The reach-out route now persists an
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
import os from "node:os";
import path from "node:path";
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

const TMP = path.join(os.tmpdir(), `kp-sourcing-attribution-${process.pid}.sqlite`);
process.env.KP_DB_PATH = TMP;

const { createPipelineEntry } = await import("./db.ts");

after(() => {
  for (const f of [TMP, `${TMP}-wal`, `${TMP}-shm`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* file locked / absent — fine */
    }
  }
});

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
