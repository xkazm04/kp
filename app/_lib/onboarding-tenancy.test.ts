import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (E0 Phase 1) — source guard for the onboarding hand-off store
// (onboarding-store.ts): onboarding_templates, onboarding_runs, onboarding_task_states,
// onboarding_intake, onboarding_signatures. The RECRUITER enumeration reads
// (listTemplates, listRuns + its intake-submitted set) and every INSERT must carry
// workspace_id so one team can neither list nor accrete into another team's onboarding.
// Everything else is exempt: templates are per-team; a run derives its tenant from the
// Hired candidate's entry; child rows (task states / intake / signatures) from their
// run — via by-id DERIVATION reads — and the point/child ops are keyed by a
// globally-unique id / entry_id / run_id, and the pre-boarding reminder sweep is a
// global system job.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "onboarding-store.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

const OB_TABLES = /\b(from|into|update)\s+(onboarding_templates|onboarding_runs|onboarding_task_states|onboarding_intake|onboarding_signatures)\b/i;
const KEY_OP = /\b(id|entry_id|run_id|template_id|task_id)\s*=\s*\?/i; // point/child op on a globally-unique key
const DERIVE = /select\s+[^`]*\bworkspace_id\b[^`]*\bfrom\b/i; // tenant-derivation read from a parent
const REMINDER = /reminder/i; // the global pre-boarding reminder sweep / claim

test("every onboarding enumeration/insert query is workspace-scoped (by-id/derive/reminder exempt)", () => {
  const touching = sqlBlocks.filter((s) => OB_TABLES.test(s));
  assert.ok(touching.length >= 10, `expected >=10 onboarding queries, found ${touching.length}`);
  const mustScope = touching.filter((s) => !KEY_OP.test(s) && !DERIVE.test(s) && !REMINDER.test(s));
  assert.ok(mustScope.length >= 6, `expected the enumeration reads + INSERTs to require scoping, found ${mustScope.length}`);
  for (const sql of mustScope) {
    assert.ok(/workspace_id/.test(sql), `an onboarding query is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`);
  }
});
