import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (P1) — source guard for the pipeline AUDIT TRAILS (pipeline_events +
// consent_events). Covers the RUNTIME readers/writers: pipeline.ts (the readers +
// logConsentEvent), analytics.ts (funnel/momentum counts), and the sim reset. The
// central WRITE (core.ts recordEvent) auto-derives the tenant from the linked entry
// and is verified behaviorally by pipeline-isolation.ts (an untagged event wouldn't
// be found). core.ts's GLOBAL boot migrations (migratePipelineStages,
// backfillDeclinedStatus) are deliberately tenant-agnostic and excluded here.
const dir = path.dirname(fileURLToPath(import.meta.url));
const files = [path.join(dir, "pipeline.ts"), path.join(dir, "analytics.ts"), path.join(dir, "..", "sim-store.ts")];
const src = files.map((f) => readFileSync(f, "utf8")).join("\n");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

test("every pipeline_events / consent_events runtime query is workspace-scoped", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update|delete\s+from)\s+(pipeline_events|consent_events)\b/i.test(s));
  assert.ok(touching.length >= 12, `expected >=12 audit-trail queries, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(/workspace_id/.test(sql), `an audit-trail query is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`);
  }
});
