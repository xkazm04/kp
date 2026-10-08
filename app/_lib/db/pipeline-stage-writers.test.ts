// The CENSUS of every writer of `pipeline_entries.stage`.
//
// The terminal stage is outcome-bearing: it is reached by an ACCEPTED OFFER, never by a
// move. That invariant is enforced PER DOOR (set_stage, accept, the add door, batch, the
// command bar, and now the stage-migration door), and a per-door guard has one failure
// mode: a NEW door that nobody guards. The stage-migration door was exactly that, and the
// council found it with a probe rather than a gate.
//
// So the guard stays per door, and this test makes every door DECLARE itself. It walks
// app/ and pipeline/ (no test files) for
//   1. every SQL statement that writes the stage column (UPDATE pipeline_entries SET …
//      stage = …, INSERT INTO pipeline_entries) — keyed by the enclosing function; and
//   2. every call of a store function that writes it;
// and compares both with the tables below. A writer that is new, unclassified, counted
// differently or gone fails, and the failure names it. Adding a door means adding its row
// — and writing down, in the row, how it keeps the terminal stage for the offer.
//
// Classes:
//   refuses-terminal   a guard on the path, pinned by file:line (the guarded line must
//                      still contain `needle`; if the guard moved, the failure says where)
//   terminal-by-design the writer IS the way onto the outcome stage
//   migration          a boot/legacy remap, never request-driven
//   seed               demo or fixture data
//   not-a-move         files at the entry/landing stage, or closes by status, or re-files
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");

type Guard = { file: string; line: number; needle: string };
type Class = "refuses-terminal" | "terminal-by-design" | "migration" | "seed" | "not-a-move";
type Row = { cls: Class; count: number; why: string; guard?: Guard };

const ENTRY_ACTION = "app/_lib/pipeline-entry-action.ts";
const STORE = "app/_lib/db/pipeline.ts";
const ADD_DOOR = "app/api/pipeline/route.ts";
const MIGRATION_ROUTE = "app/api/pipeline/stage-migration/route.ts";

const G_STORE_MIGRATE: Guard = { file: STORE, line: 1229, needle: 'stageHasRole(leg.toStage, "terminal", toAxis)' };
const G_STORE_ACT: Guard = { file: STORE, line: 3544, needle: 'opts?.outcome === "offer_accepted"' };
const G_SET_STAGE: Guard = { file: ENTRY_ACTION, line: 408, needle: 'if (stageHasRole(to, "terminal", axis))' };
const G_ACCEPT: Guard = { file: ENTRY_ACTION, line: 467, needle: "acceptWouldReachTerminal(current.stage, axis)" };
const G_ADD: Guard = { file: ADD_DOOR, line: 175, needle: 'stageHasRole(body.stage, "terminal", axis.stages)' };
const G_MIGRATION_ROUTE: Guard = { file: MIGRATION_ROUTE, line: 110, needle: 'stageHasRole(toStage, "terminal", next.stages)' };

// ---- 1. SQL writers: `file#function` -> statements that write the stage column ----
const SQL_WRITERS: Record<string, Row> = {
  [`${STORE}#migratePipelineStages`]: {
    cls: "refuses-terminal",
    count: 1,
    why: "the store refuses any leg whose destination has the terminal role on the axis it moves INTO",
    guard: G_STORE_MIGRATE,
  },
  [`${STORE}#setPipelineEntryStage`]: {
    cls: "refuses-terminal",
    count: 1,
    why: "the store takes any known stage; its request-driven caller refuses terminal (see the setPipelineEntryStage callers)",
    guard: G_SET_STAGE,
  },
  [`${STORE}#actOnPipelineEntry`]: {
    cls: "refuses-terminal",
    count: 3,
    why: "screening_review / accept advance one column and the store refuses (null, nothing written) one that would land on terminal unless the caller passes outcome: offer_accepted; approve_event keeps the stage when the gate is the terminal column",
    guard: G_STORE_ACT,
  },
  [`${STORE}#reinstatePipelineEntry`]: {
    cls: "not-a-move",
    count: 1,
    why: "puts a rejected candidate back on the screened-landing column, never the terminal one",
  },
  [`${STORE}#createPipelineEntry`]: {
    cls: "refuses-terminal",
    count: 1,
    why: "the INSERT takes the stage its caller names; the HTTP add door refuses terminal by role, in-process callers name entry/landing stages (see the createPipelineEntry callers)",
    guard: G_ADD,
  },
  "app/_lib/db/core.ts#migratePipelineStages": {
    cls: "migration",
    count: 1,
    why: "boot remap of the legacy 7-stage rows to the 5-stage model",
  },
  "app/_lib/db/core.ts#seedPipeline": {
    cls: "seed",
    count: 1,
    why: "demo corpus from data/seed_pipeline, once, recorded in seed_marks",
  },
  "app/_lib/db/seed-benchmark-team.ts#seedBenchmarkTeam": {
    cls: "seed",
    count: 1,
    why: "the benchmark team's fixture entries",
  },
  "pipeline/jobfit/seed_interview_calendar.py#main": {
    cls: "seed",
    count: 1,
    why: "demo backfill: it SELECTs stage='Interview' and writes approval_kind only — it never writes stage",
  },
};

// ---- 2. callers of the store functions that write the stage ----
const STORE_FNS = ["setPipelineEntryStage", "actOnPipelineEntry", "migratePipelineStages", "createPipelineEntry", "reinstatePipelineEntry"];

const CALLERS: Record<string, Row> = {
  // migratePipelineStages
  [`${MIGRATION_ROUTE} -> migratePipelineStages`]: {
    cls: "refuses-terminal",
    count: 1,
    why: "the route 422s a mapping onto, or a re-role of, the terminal stage before any move; the store re-checks",
    guard: G_MIGRATION_ROUTE,
  },
  // setPipelineEntryStage
  [`${ENTRY_ACTION} -> setPipelineEntryStage`]: {
    cls: "refuses-terminal",
    count: 1,
    why: "set_stage: 422 PIPELINE_TERMINAL_NOT_MANUAL by role",
    guard: G_SET_STAGE,
  },
  "app/_lib/agent-hire/lifecycle.ts -> setPipelineEntryStage": {
    cls: "terminal-by-design",
    count: 1,
    why: "an approved agent hire lands on the terminal column; there is no candidate offer for an agent",
  },
  // actOnPipelineEntry
  [`${ENTRY_ACTION} -> actOnPipelineEntry`]: {
    cls: "refuses-terminal",
    count: 2,
    why: "accept: 422 PIPELINE_TERMINAL_NOT_ADVANCE when the advance would land on terminal",
    guard: G_ACCEPT,
  },
  "app/_lib/offer-finalize.ts -> actOnPipelineEntry": {
    cls: "terminal-by-design",
    count: 1,
    why: "the candidate's accepted offer is the one way onto the terminal column: it passes outcome: offer_accepted, the store guard's opt-in",
  },
  "app/_lib/screen-wave.ts -> actOnPipelineEntry": {
    cls: "not-a-move",
    count: 1,
    why: "reject: closes the entry by status, writes no stage",
  },
  "app/_lib/automation-pass.ts -> actOnPipelineEntry": {
    cls: "refuses-terminal",
    count: 1,
    why: "STORE GUARD: policy advance goes entry/screening -> next column by role; on an axis with no interview/offer column that next column is the terminal one; the store refuses the landing (accept / ratify) or keeps the stage (approve_event)",
    guard: G_STORE_ACT,
  },
  "app/_lib/automation-run.ts -> actOnPipelineEntry": {
    cls: "refuses-terminal",
    count: 2,
    why: "STORE GUARD: screening advance / plan-gate ratify: same reach as the policy advance on a degenerate axis; the store refuses the landing (accept / ratify) or keeps the stage (approve_event)",
    guard: G_STORE_ACT,
  },
  "app/api/schedule/route.ts -> actOnPipelineEntry": {
    cls: "refuses-terminal",
    count: 2,
    why: "STORE GUARD: approve_event lands on the screening gate (first interview, else offer, else terminal column); terminal only on an axis with neither; the store refuses the landing (accept / ratify) or keeps the stage (approve_event)",
    guard: G_STORE_ACT,
  },
  "app/api/schedule/[token]/route.ts -> actOnPipelineEntry": {
    cls: "refuses-terminal",
    count: 1,
    why: "STORE GUARD: approve_event, as above; the store refuses the landing (accept / ratify) or keeps the stage (approve_event)",
    guard: G_STORE_ACT,
  },
  // reinstatePipelineEntry
  "app/api/pipeline/[id]/route.ts -> reinstatePipelineEntry": {
    cls: "not-a-move",
    count: 1,
    why: "the reconsider door: lands on the screened-landing column by role, never the terminal one",
  },
  "app/_lib/db/core.ts -> migratePipelineStages": {
    cls: "migration",
    count: 1,
    why: "the boot call of the legacy remap (core.ts's own function of that name, not the store's)",
  },
  // createPipelineEntry
  [`${ADD_DOOR} -> createPipelineEntry`]: {
    cls: "refuses-terminal",
    count: 1,
    why: "the add door: 422 PIPELINE_TERMINAL_NOT_MANUAL by role",
    guard: G_ADD,
  },
  "app/api/jobs/[id]/candidates/outreach/route.ts -> createPipelineEntry": {
    cls: "not-a-move",
    count: 1,
    why: 'files at the literal "Screened" column',
  },
  "app/api/sim/inbound/route.ts -> createPipelineEntry": {
    cls: "not-a-move",
    count: 1,
    why: "files at the entry stage of the workspace axis (simulation)",
  },
  "app/_lib/agent-hire/lifecycle.ts -> createPipelineEntry": {
    cls: "not-a-move",
    count: 1,
    why: "files the agent at the offer column; the terminal move is the setPipelineEntryStage row above",
  },
  "app/_lib/agent-hire/transform-run.ts -> createPipelineEntry": {
    cls: "not-a-move",
    count: 1,
    why: "no stage named: files at the default entry stage",
  },
  "app/_lib/application-filing.ts -> createPipelineEntry": {
    cls: "not-a-move",
    count: 1,
    why: "an application files at the entry stage by role",
  },
  "app/_lib/automation-run.ts -> createPipelineEntry": {
    cls: "not-a-move",
    count: 1,
    why: "rematch files at the screened-landing stage by role",
  },
  "app/_lib/devcase-run.ts -> createPipelineEntry": {
    cls: "not-a-move",
    count: 2,
    why: 'files at "Accepted" / the default entry stage',
  },
  "app/_lib/interview-sim/instrument.ts -> createPipelineEntry": {
    cls: "seed",
    count: 3,
    why: "the interview simulator's own fixture entries",
  },
};

// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(["node_modules", ".next", "__pycache__", "tests", "__tests__", "testing"]);
const isTestFile = (f: string) => /\.test\.(ts|tsx|mjs)$|(^|\/)test_[^/]*\.py$|\.spec\.ts$/.test(f);

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) sources(rel, out);
    } else if (/\.(ts|tsx|py)$/.test(e.name) && !isTestFile(rel) && !e.name.endsWith(".d.ts")) {
      out.push(rel);
    }
  }
  return out;
}

/** Comments out; offsets (and so line numbers) preserved by blanking, not deleting. */
function stripComments(src: string, py: boolean): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  if (py) return src.replace(/^\s*#.*$/gm, blank);
  return src.replace(/^[ 	]*\/\*[\s\S]*?\*\//gm, blank).replace(/^\s*\/\/.*$/gm, blank);
}

/** The function a statement sits in; a statement at module level inside a const-named
 *  block is keyed by the nearest preceding `function`, which is stable enough to name it. */
function enclosingFn(code: string, index: number, py: boolean): string {
  const re = py ? /^\s*(?:async\s+)?def\s+(\w+)/gm : /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
  let name = "<module>";
  for (const m of code.matchAll(re)) {
    if ((m.index ?? 0) > index) break;
    name = m[1];
  }
  return name;
}

function censusSql(): Map<string, number> {
  const found = new Map<string, number>();
  const bump = (k: string) => found.set(k, (found.get(k) ?? 0) + 1);
  for (const file of [...sources("app"), ...sources("pipeline")]) {
    const py = file.endsWith(".py");
    const code = stripComments(fs.readFileSync(path.join(ROOT, file), "utf8"), py);
    // A statement that writes the stage column. `\bstage\s*=` does not match stage_changed_at.
    for (const m of code.matchAll(/UPDATE\s+pipeline_entries\s+SET\s+((?:(?!\bWHERE\b)[^`;]){0,600})/gi)) {
      // pipeline/ is Python-side: any write to the table is declared, stage or not, because
      // a script that writes the table can write the column next week.
      if (/\bstage\s*=/i.test(m[1]) || py) bump(`${file}#${enclosingFn(code, m.index ?? 0, py)}`);
    }
    for (const m of code.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+pipeline_entries\b/gi)) {
      bump(`${file}#${enclosingFn(code, m.index ?? 0, py)}`);
    }
  }
  return found;
}

function censusCallers(): Map<string, number> {
  const found = new Map<string, number>();
  for (const file of sources("app")) {
    const code = stripComments(fs.readFileSync(path.join(ROOT, file), "utf8"), false);
    for (const fn of STORE_FNS) {
      const declared = (code.match(new RegExp(`function\\s+${fn}\\s*\\(`, "g")) ?? []).length;
      const calls = (code.match(new RegExp(`\\b${fn}\\s*\\(`, "g")) ?? []).length - declared;
      if (calls > 0) found.set(`${file} -> ${fn}`, calls);
    }
  }
  return found;
}

function compare(kind: string, table: Record<string, Row>, found: Map<string, number>): string[] {
  const problems: string[] = [];
  for (const [key, n] of found) {
    const row = table[key];
    if (!row) problems.push(`${kind} NEW or UNCLASSIFIED: ${key} (x${n}) — add a row saying how it keeps the terminal stage for the offer`);
    else if (row.count !== n) problems.push(`${kind} COUNT CHANGED: ${key} is declared x${row.count}, found x${n} — classify the extra site`);
  }
  for (const key of Object.keys(table)) {
    if (!found.has(key)) problems.push(`${kind} GONE: ${key} is in the table but no longer found — delete its row`);
  }
  return problems;
}

test("every SQL writer of pipeline_entries.stage is classified, and none is missing", () => {
  const problems = compare("sql-writer", SQL_WRITERS, censusSql());
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("every caller of a stage-writing store function is classified, and none is missing", () => {
  const problems = compare("caller", CALLERS, censusCallers());
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("every 'refuses-terminal' row's guard is still on the line the table pins", () => {
  const problems: string[] = [];
  for (const [key, row] of [...Object.entries(SQL_WRITERS), ...Object.entries(CALLERS)]) {
    if (row.cls === "refuses-terminal" && !row.guard) problems.push(`${key}: refuses-terminal without a guard`);
    if (!row.guard) continue;
    const lines = fs.readFileSync(path.join(ROOT, row.guard.file), "utf8").split(/\r?\n/);
    const at = lines.findIndex((l) => l.includes(row.guard!.needle));
    if (at < 0) problems.push(`${key}: guard \`${row.guard.needle}\` is no longer in ${row.guard.file}`);
    else if (!lines[row.guard.line - 1]?.includes(row.guard.needle)) {
      problems.push(`${key}: guard is at ${row.guard.file}:${at + 1}, the table pins :${row.guard.line}`);
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});
