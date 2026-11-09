// Tenant scope + window + demo-residue exclusion of the Pipeline overview's automated-action counts.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ensureDb, recordEvent } from "./core.ts";
import { automationCountsSince } from "./automation-counts.ts";

after(() => cleanupUnitDb());

const NOW = Date.UTC(2026, 9, 16, 12);
const day = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const A = "counts-ws-a";
const B = "counts-ws-b";
const db = ensureDb();
const ev = (workspaceId: string, kind: string, createdAt: string, jobTitle: string | null = "Backend") =>
  recordEvent(db, { workspaceId, entryId: null, candidateLabel: null, jobTitle, kind, detail: null, createdAt });

ev(A, "scored", day(1));
ev(A, "scored", day(6));
ev(A, "scored", day(8)); // outside the 7-day window
ev(A, "interview_invite_sent", day(2));
ev(A, "outreach_sent", day(3));
ev(A, "advanced", day(1)); // a human move
ev(B, "scored", day(1)); // another tenant
ev(B, "scored", day(1));
ev(B, "scored", day(1));

test("counts only this workspace's automated actions inside the window", () => {
  assert.deepEqual(automationCountsSince(NOW, 7, A), { total: 4, screens: 2, outreach: 1, invites: 1 });
  assert.deepEqual(automationCountsSince(NOW, 7, B), { total: 3, screens: 3, outreach: 0, invites: 0 });
});

test("a workspace with no events is an honest zero", () => {
  assert.equal(automationCountsSince(NOW, 7, "counts-ws-empty").total, 0);
});
