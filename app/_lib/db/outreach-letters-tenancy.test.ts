// TENANT SCOPE for the first-contact outreach letter (comms scope C2).
//
// `outreach_letters` holds a letter TO one named person, and its id travels through the
// approve / release routes. So, like interview_letters, the table gets NO by-id carve-out:
// every statement binds workspace_id, point reads included, and a leaked letter id resolves
// for nobody but its own team. The exemption list below is empty and meant to stay so.
//
// Two halves, because either alone is hollow: the STORE must filter, and the store must be
// the only thing that reaches the table outside the erasure scrub.
//
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const {
  outreachLetterApprove,
  outreachLetterByEntry,
  outreachLetterById,
  outreachLetterDraft,
  outreachLetterMarkFailed,
  outreachLetterMarkReleased,
  outreachLetterMarkSuppressed,
} = await import("./outreach-letters.ts");
const { createPipelineEntry } = await import("./pipeline.ts");
const { DEFAULT_WORKSPACE_ID } = await import("./workspaces.ts");

after(() => cleanupUnitDb());

const OTHER_WS = "team-beta";

// ---- the SQL half ---------------------------------------------------------

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(dir, "outreach-letters.ts"), "utf8").replace(/\r\n/g, "\n");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

test("every outreach_letters statement binds workspace_id — no by-id exemption", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update)\s+outreach_letters\b/i.test(s));
  assert.ok(touching.length >= 6, `expected every letter query, found ${touching.length}`);
  const EXEMPT: readonly string[] = [];
  let inserts = 0;
  let predicates = 0;
  for (const sql of touching) {
    if (EXEMPT.some((e) => sql.includes(e))) continue;
    if (/\binsert\s+into\s+outreach_letters\b/i.test(sql)) {
      assert.match(sql, /\(\s*id,\s*workspace_id\b/i, `an outreach_letters INSERT does not stamp workspace_id:\n${sql.trim()}`);
      inserts += 1;
      continue;
    }
    assert.match(sql, /workspace_id\s*=\s*\?/, `an outreach_letters statement is NOT workspace-bound:\n${sql.trim().slice(0, 200)}`);
    predicates += 1;
  }
  assert.equal(inserts, 1, "expected the draft INSERT");
  assert.ok(predicates >= 5, `expected every read/update to carry the predicate, saw ${predicates}`);
});

test("one letter per application is keyed per team", () => {
  const core = readFileSync(path.join(dir, "core.ts"), "utf8").replace(/\r\n/g, "\n");
  assert.match(core, /CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_letters_entry ON outreach_letters \(workspace_id, entry_id\)/);
});

test("outside this store, only the erasure scrub touches the table", () => {
  const appDir = path.resolve(dir, "..", "..");
  const offenders: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(p);
        continue;
      }
      if (!e.name.endsWith(".ts") || e.name.endsWith(".test.ts")) continue;
      if (p === path.join(dir, "outreach-letters.ts") || p === path.join(dir, "core.ts")) continue;
      const text = readFileSync(p, "utf8");
      for (const m of text.matchAll(/`([^`]*)`/g)) {
        if (/\b(from|into|update)\s+outreach_letters\b/i.test(m[1])) offenders.push(`${path.relative(appDir, p)}: ${m[1].trim().slice(0, 80)}`);
      }
    }
  };
  walk(appDir);
  assert.deepEqual(
    offenders.map((o) => o.split(":")[0]),
    [path.join("_lib", "db", "pipeline.ts")],
    `only the erasure scrub may write outreach_letters outside its store:\n${offenders.join("\n")}`
  );
  assert.match(offenders[0] ?? "", /UPDATE outreach_letters SET subject = NULL, body = NULL/, "…and that write is the scrub");
});

// ---- the behavioural half -------------------------------------------------

function entry(ws: string) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return createPipelineEntry({
    candidateId: `c-olt-${suffix}`,
    candidateLabel: "Tenancy Candidate",
    jobId: `job-olt-${suffix}`,
    jobTitle: "Data Engineer",
    stage: "Screened",
    workspaceId: ws,
  }).entry;
}

test("no read or write crosses a tenant boundary — by entry, by id, every transition", () => {
  const foreignEntry = entry(OTHER_WS);
  const { letter: foreign } = outreachLetterDraft({ entryId: foreignEntry.id, subject: "Hi", body: "Hello.", lang: "cs" }, OTHER_WS);

  assert.equal(outreachLetterByEntry(foreignEntry.id, DEFAULT_WORKSPACE_ID), null);
  assert.equal(outreachLetterById(foreign.id, DEFAULT_WORKSPACE_ID), null, "a leaked letter id resolves for nobody else");
  assert.equal(outreachLetterApprove(foreign.id, { revision: foreign.revision, approvedBy: "human:Eve" }, DEFAULT_WORKSPACE_ID), null);
  assert.equal(outreachLetterMarkReleased(foreign.id, DEFAULT_WORKSPACE_ID), null);
  assert.equal(outreachLetterMarkFailed(foreign.id, DEFAULT_WORKSPACE_ID), null);
  assert.equal(outreachLetterMarkSuppressed(foreign.id, DEFAULT_WORKSPACE_ID), null);
  const untouched = outreachLetterById(foreign.id, OTHER_WS)!;
  assert.equal(untouched.state, "drafted", "the owning team's letter is exactly as it was");
  assert.equal(untouched.approvedBy, null);

  // The same entry id drafted from another team is ANOTHER letter, never this one.
  const { letter: ours, created } = outreachLetterDraft({ entryId: foreignEntry.id, subject: "Yo", body: "Other.", lang: "en" }, DEFAULT_WORKSPACE_ID);
  assert.equal(created, true);
  assert.notEqual(ours.id, foreign.id);
  assert.equal(outreachLetterById(foreign.id, OTHER_WS)!.body, "Hello.", "and it did not overwrite the first team's row");
  assert.equal(outreachLetterByEntry(foreignEntry.id, OTHER_WS)?.id, foreign.id, "the owning team reads its own");
});
