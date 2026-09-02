// Direction 1 — the three ENTRY-KEYED interview doors are scoped to the caller's team.
//
// `/create`, `/revoke` and `/by-entry` all key on a pipeline entry id and nothing
// else, and `pipeline_entries.id` is globally unique — not a secret, and echoed by
// several recruiter surfaces. Until this change the store functions beneath them
// took no workspace at all, so an operator on one team could, with a stranger's
// entry id:
//
//   REVOKE   kill another team's live interview credential mid-call
//            (revokeOpenInterviewSessions — a bare UPDATE by entry_id);
//   READ     pull their candidate's verbatim transcript AND AI scorecard
//            (latestInterviewByEntry, the most sensitive pair in the product);
//   WRITE    mint a screen on the stranger's entry, email THEIR candidate, and have
//            the session stamped with the stranger's workspace (createInterviewSession
//            inherits the entry's team) while the minutes gate had checked the
//            caller's — gate and debit reading two different tenants.
//
// Store-level behavioural (the predicate) + source-level for the route contract
// (these handlers need a request scope the unit runner cannot give them), the same
// split `tasks-route-tenancy.test.ts` uses.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import {
  createInterviewSession,
  latestInterviewByEntry,
  liveInterviewByEntry,
  markInterviewStarted,
  revokeOpenInterviewSessions,
} from "../../_lib/db/interviews.ts";
import { createPipelineEntry } from "../../_lib/db/pipeline.ts";
import { DEFAULT_WORKSPACE_ID } from "../../_lib/db/workspaces.ts";

after(() => cleanupUnitDb());

const WS_B = "team-interview-doors-b";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(path.join(HERE, ...p), "utf8");

function entryOn(workspaceId: string, id: string) {
  const { entry } = createPipelineEntry({
    candidateId: `cand-${id}`,
    candidateLabel: `Candidate ${id}`,
    jobId: `job-${id}`,
    jobTitle: "Backend",
    workspaceId,
  });
  return entry;
}

// ---- store predicate ------------------------------------------------------

test("/revoke: another team's open link survives a revoke aimed at its entry id", () => {
  const entry = entryOn(WS_B, "revoke");
  const session = createInterviewSession({ provider: "openai", mode: "candidate", entryId: entry.id, durationMin: 20 });
  assert.equal(session.workspaceId, WS_B, "the session inherits the entry's team");

  assert.equal(
    revokeOpenInterviewSessions(entry.id, DEFAULT_WORKSPACE_ID),
    0,
    "a stranger's revoke must not touch a live credential"
  );
  assert.equal(latestInterviewByEntry(entry.id, WS_B)?.status, "created", "the link is still live for its owner");

  assert.equal(revokeOpenInterviewSessions(entry.id, WS_B), 1, "the owning team still revokes its own");
  assert.equal(latestInterviewByEntry(entry.id, WS_B)?.status, "revoked");
});

test("/by-entry: the transcript + scorecard read answers nothing for a foreign entry", () => {
  const entry = entryOn(WS_B, "read");
  createInterviewSession({ provider: "openai", mode: "candidate", entryId: entry.id, durationMin: 20 });

  assert.equal(
    latestInterviewByEntry(entry.id, DEFAULT_WORKSPACE_ID),
    null,
    "a cross-tenant entry id reads as absent, exactly like an unknown one"
  );
  assert.ok(latestInterviewByEntry(entry.id, WS_B), "the owning team still reads its own");
});

test("/create: the reissue guard cannot see another team's live call", () => {
  const entry = entryOn(WS_B, "live");
  const session = createInterviewSession({ provider: "openai", mode: "candidate", entryId: entry.id, durationMin: 20 });
  // Flip it live the way /connect does, through the store's own door.
  assert.ok(markInterviewStarted(session.id, true), "the session goes live");

  assert.ok(liveInterviewByEntry(entry.id, WS_B), "the owning team sees its live call");
  assert.equal(
    liveInterviewByEntry(entry.id, DEFAULT_WORKSPACE_ID),
    null,
    "a stranger sees no live call — so their reissue would have revoked it and emailed the candidate mid-conversation"
  );
});

// ---- route contract -------------------------------------------------------

test("every entry-keyed interview route threads the caller's tenant", () => {
  const create = read("create", "route.ts");
  const revoke = read("revoke", "route.ts");
  const byEntry = read("by-entry", "route.ts");
  const compare = read("compare", "route.ts");

  for (const [name, src] of [["create", create], ["revoke", revoke], ["by-entry", byEntry], ["compare", compare]] as const) {
    assert.match(src, /currentWorkspace\(\)/, `${name} must resolve the caller's team`);
  }

  assert.match(create, /liveInterviewByEntry\(entryId,\s*workspace\)/, "create's reissue guard is scoped");
  assert.match(create, /revokeOpenInterviewSessions\(entryId,\s*workspace\)/, "create's revoke-first is scoped");
  assert.match(create, /buildGroundedInterview\(entryId,\s*workspace\)/, "a foreign entry must 404 out of the brief build");
  assert.match(revoke, /revokeOpenInterviewSessions\(entryId,\s*await currentWorkspace\(\)\)/, "revoke is scoped");
  assert.match(byEntry, /latestInterviewByEntry\(entry,\s*workspace\)/, "the ?entry= read is scoped");
  assert.match(byEntry, /latestInterviewByEntry\(linked\.id,\s*workspace\)/, "the ?submission= read is scoped");
  // The ?entry= branch must NOT resolve the tenant from the row it is about to
  // return: getEntryWorkspace answers whatever team owns the entry, which scoped
  // the consent lookup to the stranger's tenant while still serving their transcript.
  assert.doesNotMatch(byEntry, /import[^;]*getEntryWorkspace/, "the caller team is the authority here, not the row owner");
  assert.match(compare, /telemetryForEntry\(c\.entryId,\s*workspace\)/, "compare's telemetry re-read is scoped");
});
