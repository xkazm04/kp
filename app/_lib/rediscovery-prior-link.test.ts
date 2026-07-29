// Close-the-prior on a manual rediscovery reach-out (direction 3). Drives the REAL
// db.ts + linkTerminalPriorsToTarget against a throwaway SQLite file to pin that a
// reach-out links the candidate's terminal priors to the fresh target entry using the
// SAME rematchSourceEntry machinery the automation path uses — and NEVER touches an
// active or Hired prior, and honors workspace scoping (direction 1).
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
// Import better-sqlite3 BEFORE registerHooks so the module (and its internal CJS
// requires) is cached and never intercepted by the relative-rewrite hook below.
import Database from "better-sqlite3";

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
// It used to be a hand-rolled `os.tmpdir()/kp-rediscovery-prior-link-${process.pid}.sqlite`.
// `--test-isolation=process` gives each FILE a fresh process, but the OS RECYCLES pids:
// a later run drawing a pid this file used before re-opens that run's leftover database
// and inherits its committed entries/priors (see 7c63692, the billing-suite flake). unit-db.ts is the
// repo-wide fix: a mkdtemp'd run directory (unique by construction, never pid-derived),
// a liveness-gated sweep of abandoned dirs, and cleanupUnitDb().
const { cleanupUnitDb, UNIT_DB_PATH: TMP } = await import("./testing/unit-db.ts");

const WS_B = "team-beta";

const { createPipelineEntry, actOnPipelineEntry, getPipelineEntry } = await import("./db.ts");
const { linkTerminalPriorsToTarget } = await import("./rediscovery-prior-link.ts");

function events(entryId: string): { kind: string; detail: string | null }[] {
  const d = new Database(TMP, { readonly: true });
  const rows = d
    .prepare(`SELECT kind, detail FROM pipeline_events WHERE entry_id = ? ORDER BY id`)
    .all(entryId) as { kind: string; detail: string | null }[];
  d.close();
  return rows;
}

let n = 0;
function mkTarget(candidateId: string): { id: string; jobId: string } {
  n += 1;
  const jobId = `tgtJob${process.pid}_${n}`;
  const { entry } = createPipelineEntry({
    candidateId,
    candidateLabel: candidateId,
    jobId,
    jobTitle: `Target Role ${n}`,
    stage: "Screened",
  });
  return { id: entry.id, jobId };
}

// Closes the memoized main connection and removes this run's temp dir; a still-open
// isolated handle only means the fixture's sweep reclaims the dir on a later run.
after(cleanupUnitDb);

test("links a REJECTED prior to the target, keeping the prior's status (re-engagement)", () => {
  const cand = `c${process.pid}_rej`;
  const { entry: prior } = createPipelineEntry({
    candidateId: cand,
    candidateLabel: cand,
    jobId: `priorJob${process.pid}_rej`,
    jobTitle: "Prior Role",
    stage: "Screened",
  });
  actOnPipelineEntry(prior.id, "reject");
  assert.equal(getPipelineEntry(prior.id)?.status, "rejected");

  const target = mkTarget(cand);
  const linked = linkTerminalPriorsToTarget(cand, target.id, target.jobId, "workspace");

  assert.equal(linked, 1);
  // Prior's terminal status is preserved — a company reject stays a reject…
  assert.equal(getPipelineEntry(prior.id)?.status, "rejected");
  // …but now carries the source→target link, and the target carries the back-link.
  const priorLink = events(prior.id).find((e) => e.kind === "rematched");
  assert.ok(priorLink, "prior gets a rematched link event");
  assert.match(priorLink?.detail ?? "", new RegExp(`-> ${target.jobId} \\(${target.id}\\)`));
  assert.ok(
    events(target.id).some((e) => e.kind === "rematched_from" && (e.detail ?? "").includes(prior.id)),
    "target gets a rematched_from back-link"
  );
});

test("NEVER links an ACTIVE prior (never closes a live application)", () => {
  const cand = `c${process.pid}_act`;
  createPipelineEntry({
    candidateId: cand,
    candidateLabel: cand,
    jobId: `priorJob${process.pid}_act`,
    jobTitle: "Active Prior",
    stage: "Interview",
  });
  const target = mkTarget(cand);
  assert.equal(linkTerminalPriorsToTarget(cand, target.id, target.jobId, "workspace"), 0);
});

test("NEVER links a HIRED prior", () => {
  const cand = `c${process.pid}_hire`;
  createPipelineEntry({
    candidateId: cand,
    candidateLabel: cand,
    jobId: `priorJob${process.pid}_hire`,
    jobTitle: "Hired Prior",
    stage: "Hired",
  });
  const target = mkTarget(cand);
  assert.equal(linkTerminalPriorsToTarget(cand, target.id, target.jobId, "workspace"), 0);
});

test("respects workspace scoping — a prior in another tenant is not linked", () => {
  const cand = `c${process.pid}_ws`;
  const { entry: prior } = createPipelineEntry({
    candidateId: cand,
    candidateLabel: cand,
    jobId: `priorJob${process.pid}_ws`,
    jobTitle: "Beta Prior",
    stage: "Screened",
    workspaceId: WS_B,
  });
  actOnPipelineEntry(prior.id, "reject", undefined, undefined, WS_B);
  assert.equal(getPipelineEntry(prior.id, WS_B)?.status, "rejected");

  const target = mkTarget(cand); // target in the default workspace
  // Called for the DEFAULT workspace — the team-beta prior must be invisible.
  assert.equal(linkTerminalPriorsToTarget(cand, target.id, target.jobId, "workspace"), 0);
});
