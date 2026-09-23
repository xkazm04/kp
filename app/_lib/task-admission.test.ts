// Every task kind declares its door and its seat.
//
// POST /api/tasks is the dock's one door, and it used to admit every kind in
// TASK_KINDS with the client's params verbatim — although nine of those kinds are only
// ever enqueued by a server route that builds and validates their params first (and
// asks the seat). `analyze` was the worst of them (its params are file paths); the
// coordinator's fix closed that one kind with a one-entry set. This file pins the
// general table that replaced the set, and — by reading the tree — that the table
// agrees with who actually starts each kind:
//
//   • every kind a client module passes to startTask("…") (or posts to /api/tasks)
//     is a DOCK kind, so tightening the door never strands a working button;
//   • every kind a server module enqueues that no client names is a SERVER kind, so a
//     new server-built kind cannot quietly ride the generic door with client params.
//
// Runner: node:test, via `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_CAPABILITIES } from "./auth/roles.ts";
import { TASK_KINDS } from "./task-kinds.ts";
import { TASK_KIND_ADMISSION, dockMayStart, serverOnlyTaskKinds, taskKindCapability } from "./task-admission.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// The nine the challenge card named. jobseeker_scan is enqueued through the
// SCAN_TASK_KIND constant, never a literal — the scan below has to resolve it.
const SERVER_KINDS = [
  "agent_fit",
  "analyze",
  "companion_digest",
  "interview_kit",
  "interview_letter",
  "jd_build",
  "jobseeker_scan",
  "lifecycle",
  "repo_scan",
];

test("the table decides every kind: a door and a capability for each, no stale extra key", () => {
  assert.deepEqual(Object.keys(TASK_KIND_ADMISSION).sort(), [...TASK_KINDS].sort());
  for (const k of TASK_KINDS) {
    const a = TASK_KIND_ADMISSION[k];
    assert.ok(a.door === "dock" || a.door === "server", `${k} has no door`);
    assert.ok(ALL_CAPABILITIES.includes(a.capability), `${k} asks a capability outside the vocabulary`);
  }
});

test("exactly the nine server-built kinds are closed to the dock", () => {
  assert.deepEqual([...serverOnlyTaskKinds()].sort(), SERVER_KINDS);
  for (const k of TASK_KINDS) assert.equal(dockMayStart(k), !SERVER_KINDS.includes(k), k);
});

test("every current kind is a recruiter act; an unknown kind fails closed to the recruiter seat", () => {
  for (const k of TASK_KINDS) assert.equal(taskKindCapability(k), "pipeline:write", k);
  // A row written by an older build can still be retried or cancelled: it asks the
  // write seat, never nothing.
  assert.equal(taskKindCapability("a_kind_this_build_forgot"), "pipeline:write");
  assert.equal(taskKindCapability("constructor"), "pipeline:write");
  assert.equal(dockMayStart("constructor"), false, "a prototype key is not a dock kind");
});

// ---- the source scan -------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walk(p, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/** Strip line and block comments, so a startTask("…") inside prose is not a caller. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** `export const NAME = "literal"` across the given sources — how a kind named by a
 *  constant (SCAN_TASK_KIND) is resolved back to its value. */
function stringConstants(sources: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const src of sources) {
    for (const m of src.matchAll(/export\s+const\s+([A-Z_][A-Z0-9_]*)\s*(?::\s*[^=]+)?=\s*"([a-z_]+)"/g)) out.set(m[1], m[2]);
  }
  return out;
}

/** The kinds a source enqueues: startTask("lit", …) and startTask(CONST, …), plus a
 *  raw POST to /api/tasks carrying `kind: "lit"`. A forwarded variable
 *  (startTask(body.kind, …)) is the generic door itself and names nothing. */
function enqueuedKinds(src: string, constants: Map<string, string>): string[] {
  const body = code(src);
  const kinds: string[] = [];
  for (const m of body.matchAll(/\bstartTask\(\s*(?:"([a-z_]+)"|([A-Z_][A-Z0-9_]*)\b)/g)) {
    if (m[1]) kinds.push(m[1]);
    else if (m[2] && constants.has(m[2])) kinds.push(constants.get(m[2])!);
    else if (m[2]) kinds.push(`<unresolved:${m[2]}>`);
  }
  if (/fetch\(\s*"\/api\/tasks"/.test(body)) {
    // Only a kind in a serialized request body — a module that also posts the door can
    // carry unrelated `kind:` discriminants (a reducer's action union, say).
    for (const m of body.matchAll(/JSON\.stringify\(\{\s*kind:\s*"([a-z_]+)"/g)) kinds.push(m[1]);
  }
  return kinds;
}

test("the scanner is not blind: literals, constants and raw door posts are all found", () => {
  const consts = stringConstants([`export const SCAN_TASK_KIND = "jobseeker_scan";`, `export const X: string = "y";`]);
  assert.equal(consts.get("SCAN_TASK_KIND"), "jobseeker_scan");
  assert.deepEqual(enqueuedKinds(`const t = startTask(SCAN_TASK_KIND, { a: 1 }, ws);`, consts), ["jobseeker_scan"]);
  assert.deepEqual(enqueuedKinds(`await startTask(\n  "jd_build",\n  p)`, consts), ["jd_build"]);
  assert.deepEqual(enqueuedKinds(`// startTask("analyze", …) in prose\n/* startTask("repo_scan") */`, consts), []);
  assert.deepEqual(enqueuedKinds(`startTask(body.kind, body.params ?? {}, ws)`, consts), []);
  assert.deepEqual(enqueuedKinds(`startTask(UNKNOWN_KIND, {})`, consts), ["<unresolved:UNKNOWN_KIND>"]);
  assert.deepEqual(
    enqueuedKinds(`await fetch("/api/tasks", { method: "POST", body: JSON.stringify({ kind: "group_eval" }) })`, consts),
    ["group_eval"],
  );
});

function scan(dirs: string[]): Map<string, string[]> {
  const files = dirs.flatMap((d) => walk(path.join(ROOT, d)));
  const sources = files.map((f) => readFileSync(f, "utf8"));
  const consts = stringConstants(sources);
  const byKind = new Map<string, string[]>();
  files.forEach((f, i) => {
    for (const k of enqueuedKinds(sources[i], consts)) {
      byKind.set(k, [...(byKind.get(k) ?? []), path.relative(ROOT, f).replace(/\\/g, "/")]);
    }
  });
  return byKind;
}

const CLIENT = scan(["app/features"]);
const SERVER = scan(["app/api", "app/_lib"]);

test("every kind a client starts is a dock kind — tightening strands no button", () => {
  const kinds = [...CLIENT.keys()].sort();
  // Pinned so a scan that silently matches nothing cannot pass: these are today's
  // client callers (grep `startTask("` under app/features, plus the simulation's raw
  // POST of group_eval).
  assert.deepEqual(kinds, [
    "automation",
    "batch_outreach",
    "batch_screen",
    "design_artifacts",
    "evaluate_submission",
    "group_eval",
    "interview_prep",
    "need_analysis",
    "profile_draft",
    "reasoning",
  ]);
  for (const k of kinds) {
    assert.ok(dockMayStart(k), `${k} is started by ${CLIENT.get(k)!.join(", ")} but the dock door would refuse it`);
  }
});

test("every kind only a server module enqueues is a server kind, resolved through constants", () => {
  const unresolved = [...SERVER.keys()].filter((k) => k.startsWith("<unresolved:"));
  assert.deepEqual(unresolved, [], "a startTask(CONST) whose value the scan cannot resolve decides nothing");
  const serverOnly = [...SERVER.keys()].filter((k) => !CLIENT.has(k)).sort();
  assert.ok(serverOnly.includes("jobseeker_scan"), "jobseeker_scan is enqueued via SCAN_TASK_KIND and must be found");
  for (const k of serverOnly) {
    assert.equal(dockMayStart(k), false, `${k} is only enqueued by ${SERVER.get(k)!.join(", ")} — it must be a server kind`);
  }
  // …and the converse: a server kind with no server producer is a kind nobody can start.
  for (const k of serverOnlyTaskKinds()) assert.ok(SERVER.has(k), `${k} is closed to the dock but no server module enqueues it`);
});
