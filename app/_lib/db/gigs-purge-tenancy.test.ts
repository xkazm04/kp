// Tenant scope for the purge store (db/gigs-purge.ts): a source guard (every statement on a
// gig table binds workspace_id, as the other gig stores' guards do) and the behaviour on an
// isolated DB - a purge in one workspace never reads, counts or deletes another's gig, even
// when it is handed that gig's id.
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getGig, upsertGigFromRaw } from "./gigs.ts";
import { createGigPlanRound, listGigPlans } from "./gigs-plans.ts";
import { deleteGigPersonaRow, deleteGigsWithChildren, listGigPurgeCandidates, readGigPurgeChildren } from "./gigs-purge.ts";

after(() => cleanupUnitDb());

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(dir, "gigs-purge.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
const touches = /\b(from|into|update|join|delete\s+from)\s+(gigs|gig_plans|gig_attempts|gig_specialists|gig_outcomes)\b/i;

test("every statement in the purge store binds workspace_id (no carve-out)", () => {
  const touching = sqlBlocks.filter((s) => touches.test(s));
  assert.ok(touching.length >= 12, `expected >=12 gig statements, found ${touching.length}`);
  for (const sql of touching) assert.match(sql, /\bworkspace_id\s*=\s*\?/i, `NOT workspace-scoped:\n${sql.trim().slice(0, 200)}`);
  assert.doesNotMatch(src, /workspaceId\s*:\s*string\s*=/, "no store export defaults its tenant");
});

function gig(ws: string, key: string) {
  return upsertGigFromRaw(ws, {
    sourceId: "gsrc-t",
    arena: "security",
    raw: { externalKey: key, url: `https://example.test/${key}`, title: key, org: null, reward: null, deadlineAt: null, postedAt: null, bodyText: "x", bodyHtml: null, tags: [] },
    suspectReasons: [],
  }).gig;
}

test("one workspace's purge never reads, counts or deletes another's gig - even handed its id", () => {
  const mine = gig("ws-a", "t-1");
  const theirs = gig("ws-b", "t-2");
  createGigPlanRound("ws-b", theirs.id, [{ seat: "opus", model: "claude-opus-5-5", effort: null }]);

  assert.deepEqual(listGigPurgeCandidates("ws-a").map((g) => g.id), [mine.id]);
  const children = readGigPurgeChildren("ws-a", [theirs.id]);
  assert.deepEqual([children.plans, children.attempts, children.personas.length], [0, 0, 0]);

  const res = deleteGigsWithChildren("ws-a", [mine.id, theirs.id], { stillMatches: () => true, keepSpecialistIds: new Set() });
  assert.deepEqual(res.deleted, [mine.id], "the foreign id is simply not found");
  assert.equal(getGig("ws-a", mine.id), null);
  assert.ok(getGig("ws-b", theirs.id), "ws-b's gig survives");
  assert.equal(listGigPlans("ws-b", theirs.id).length, 1, "and so do its plans");
  assert.equal(deleteGigPersonaRow("ws-a", "gspec-anything"), false);
});
