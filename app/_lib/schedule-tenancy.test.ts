import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (P1) — source guard for the Schedule surface (schedule_invites,
// schedule-store.ts). The recruiter agenda read, the invite INSERT, the tenant
// backfill, the slot-collision checks, and the per-team booked-slot lookup all
// filter workspace_id.
//
// EXEMPTIONS: (1) the candidate self-scheduling flow is entirely token-keyed
// (WHERE token = ?) — the CSPRNG token is the capability, same doctrine as offer/
// lead tokens; (2) the reminder heartbeat's by-id claim/mark ops (WHERE id = ?); and
// (3) the global dueReminders SWEEP (LEFT JOIN pipeline_entries) runs across ALL
// teams on the scheduler tick — a per-team filter would silence other teams' reminders.
const dir = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(dir, "schedule-store.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

// A candidate token op, a reminder-sweep by-id op, or the global dueReminders sweep.
function isExempt(sql: string): boolean {
  return /\btoken\s*=\s*\?/i.test(sql) || /\bid\s*=\s*\?/i.test(sql) || /left\s+join\s+pipeline_entries/i.test(sql);
}

test("every recruiter-facing schedule_invites query is workspace-scoped (token/sweep ops exempt)", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update|delete\s+from)\s+schedule_invites\b/i.test(s));
  assert.ok(touching.length >= 6, `expected >=6 schedule_invites queries, found ${touching.length}`);
  assert.ok(touching.some(isExempt), "expected the token/sweep exemptions to match something");
  for (const sql of touching.filter((s) => !isExempt(s))) {
    assert.ok(/workspace_id/.test(sql), `a schedule_invites query is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`);
  }
});
