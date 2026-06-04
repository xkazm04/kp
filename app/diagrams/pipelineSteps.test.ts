// Keeps the interactive pipeline explorer honest (idea-6dd36b27). Its whole
// value proposition is "this is how the pipeline is ACTUALLY wired", so every
// STEP_DETAILS.files[] entry must still resolve to a real module on disk — a
// rename that leaves the drawer pointing at a dead path is silent misinformation
// for anyone onboarding. This guard fails CI the moment a referenced path drifts.
//
// It also pins the alias contract: every clickable funnel node in
// 15-automated-pipeline-tobe.puml must have a STEP_DETAILS entry and vice versa,
// so a clicked step never opens an empty drawer (the runtime warn in
// PipelineExplorer becomes a build-time failure here).
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { STEP_DETAILS } from "./pipelineSteps.ts";
import { parsePuml } from "../_components/puml/parse.ts";

// app/diagrams/ -> repo root (two levels up), so files[] entries (repo-relative)
// and the .puml source resolve regardless of the test runner's cwd.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Normalize a files[] entry to a checkable path + how to check it:
 *  - strip a trailing parenthetical note: "automation.py (evaluate_entry)" -> "automation.py"
 *  - a "dir/*" glob collapses to a directory existence check on "dir". */
function resolveEntry(entry: string): { rel: string; mustBeDir: boolean } {
  let rel = entry.replace(/\s*\([^)]*\)\s*$/, "").trim();
  let mustBeDir = false;
  if (rel.endsWith("/*")) {
    rel = rel.slice(0, -2);
    mustBeDir = true;
  }
  return { rel, mustBeDir };
}

test("every STEP_DETAILS.files[] entry resolves to a real path on disk", () => {
  const missing: string[] = [];
  for (const [stepId, detail] of Object.entries(STEP_DETAILS)) {
    for (const entry of detail.files) {
      const { rel, mustBeDir } = resolveEntry(entry);
      const abs = path.resolve(ROOT, rel);
      if (!existsSync(abs)) {
        missing.push(`${stepId}: "${entry}" -> ${rel} (not found)`);
        continue;
      }
      if (mustBeDir && !statSync(abs).isDirectory()) {
        missing.push(`${stepId}: "${entry}" -> ${rel} (expected a directory)`);
      }
    }
  }
  assert.equal(
    missing.length,
    0,
    `STEP_DETAILS points at ${missing.length} dead path(s):\n  ${missing.join("\n  ")}`
  );
});

// The funnel's clickable nodes are its component boxes (the actor is not a step).
function funnelStepAliases(): string[] {
  const src = readFileSync(path.resolve(ROOT, "docs/diagrams/15-automated-pipeline-tobe.puml"), "utf8");
  const diagram = parsePuml(src);
  return [...diagram.index.values()]
    .filter((el) => el.type === "node" && el.kind !== "actor" && el.kind !== "note")
    .map((el) => el.id);
}

test("alias contract: every funnel step has a STEP_DETAILS entry and vice versa", () => {
  const aliases = new Set(funnelStepAliases());
  const keys = new Set(Object.keys(STEP_DETAILS));

  const orphanNodes = [...aliases].filter((a) => !keys.has(a)); // clickable node, no drawer
  const orphanDetails = [...keys].filter((k) => !aliases.has(k)); // drawer entry, no node

  assert.deepEqual(
    { orphanNodes, orphanDetails },
    { orphanNodes: [], orphanDetails: [] },
    "funnel node aliases and STEP_DETAILS keys must match 1:1"
  );
});
