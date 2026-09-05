import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APPROVAL_KINDS, isApprovalKind, needsHumanDecision } from "./approval-kinds.ts";
import { DECISIONS_QUEUE_KINDS } from "@/app/features/hiring/decisions/decisionsQueueTypes";

// `approvalKind` is the single field that decides whether a pipeline entry is WAITING ON
// A PERSON. Every queue count, every board badge, the attention rail and the Art. 22
// human-in-the-loop story all branch on it — and until this file it had no test at all.
// The registry existed precisely because the vocabulary had been free-form strings in
// seed_pipeline.py, db.ts and the routes; nothing stopped it drifting back.
//
// Two things are pinned here, and they are different in kind:
//   (1) the guard's own semantics — the closed set, and that an unrecognized value is
//       NOT a gate (a typo must never masquerade as "a human is on this");
//   (2) the set against its PRODUCERS and its CONSUMERS, derived from source rather
//       than retyped, so a new kind written by a writer or consumed by a surface cannot
//       land without joining the registry.

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(APP_ROOT, "..");

test("the registry is a closed set with no duplicates", () => {
  // literal-array + derived-union + runtime guard: the union is only as trustworthy as
  // the array, and a duplicate would silently widen nothing while lying about the size.
  assert.equal(new Set(APPROVAL_KINDS).size, APPROVAL_KINDS.length, "APPROVAL_KINDS repeats a value");
  assert.ok(APPROVAL_KINDS.length >= 6, "the registry has shrunk — a kind was dropped without this test moving");
});

test("needsHumanDecision is true for every kind and for nothing else", () => {
  for (const kind of APPROVAL_KINDS) {
    assert.equal(isApprovalKind(kind), true, `${kind} must be recognized`);
    assert.equal(needsHumanDecision(kind), true, `${kind} is a gate — an entry holding it waits on a person`);
  }
  // The absence of a gate. `null` is the stored "nothing pending"; `""` is what the
  // pre-2065 clear paths wrote (see db/core.ts) and must read the same way.
  for (const empty of [null, undefined, "", "   "]) {
    assert.equal(needsHumanDecision(empty), false, `"${String(empty)}" is not a pending approval`);
  }
  // A typo, a renamed kind, a value from a newer deploy: NOT a gate. Failing the other
  // way would park a candidate behind a human click nobody can see or resolve.
  for (const bogus of ["Decision", "DECISION", "screening", "review", "scorecard-review", "calendar "]) {
    assert.equal(needsHumanDecision(bogus), false, `"${bogus}" must not read as an approval kind`);
  }
});

/** Every .ts/.tsx under app/ excluding tests (whose literals are fixtures). */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** The kinds a WRITER names as a literal: `setApproval(<entry>, "<kind>", …)` in TS, and
 *  the raw `approval_kind='<kind>'` UPDATEs (db/pipeline.ts's calendar arm, and the
 *  Python calendar seeder — a seeder that writes an unregistered kind ships a demo
 *  workspace whose entries no surface can classify).
 *
 *  One-directional on purpose: a kind passed as a variable is invisible here, so this
 *  guard says "a literal writer implies a registry entry", never "these are all of them". */
function writtenKinds(): Map<string, string> {
  const found = new Map<string, string>();
  const files = [...sourceFiles(APP_ROOT), join(REPO_ROOT, "pipeline", "jobfit", "seed_interview_calendar.py")];
  for (const file of files) {
    // CRLF vs LF: this checkout and the wave worktree disagree, and the patterns below
    // must not depend on which one they are reading.
    const src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    for (const re of [/setApproval\(\s*[^,()]+,\s*"([a-z0-9_]+)"/g, /approval_kind\s*=\s*'([a-z0-9_]+)'/g]) {
      for (const m of src.matchAll(re)) if (!found.has(m[1])) found.set(m[1], file);
    }
  }
  return found;
}

test("every approval kind a writer names in source is registered", () => {
  const written = writtenKinds();
  // Non-vacuity: if the scan stops matching (a writer is renamed, a call is reformatted)
  // it must FAIL rather than pass over an empty set.
  assert.ok(written.size >= 4, `the writer scan found only ${written.size} kinds — it has stopped matching`);
  assert.ok(written.has("scorecard_review"), "sanity: setApproval literals are seen");
  assert.ok(written.has("calendar"), "sanity: raw approval_kind UPDATE literals are seen");
  assert.deepEqual(
    [...written].filter(([k]) => !isApprovalKind(k)).map(([k, f]) => `${k} (${f.slice(REPO_ROOT.length + 1)})`),
    [],
    "written but unregistered — needsHumanDecision would report the entry as free, so it would sit in no queue and behind no badge"
  );
});

test("the Decisions queue is a strict subset of the registry, short exactly the calendar gate", () => {
  // The tab's own population (decisionsQueueTypes.ts) is the largest consumer, and its
  // documented relationship to the registry is "all of it except `calendar`, which the
  // Schedule tab owns and which this tab's accept path PRODUCES". Pinning both halves
  // means neither a new registry kind silently missing from the queue, nor a queue kind
  // that is not a real gate, can pass unnoticed.
  const registry = new Set<string>(APPROVAL_KINDS);
  assert.deepEqual(
    DECISIONS_QUEUE_KINDS.filter((k) => !registry.has(k)),
    [],
    "the Decisions queue counts a kind no writer can produce"
  );
  assert.deepEqual(
    APPROVAL_KINDS.filter((k) => !(DECISIONS_QUEUE_KINDS as readonly string[]).includes(k)),
    ["calendar"],
    "a registry kind is outside the Decisions queue and is not the calendar hand-off — either the queue is short a card or the hand-off has a second member nobody documented"
  );
});
