import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope — source guard for the agent-candidate bridge tables
// (agent_fit_specs / hired_agents / agent_activity in db/agents.ts), same shape
// as campaign-tenancy.test.ts / channels-tenancy.test.ts: every SQL statement
// touching the tables must filter/stamp workspace_id, so a future unscoped query
// fails CI instead of leaking one team's agents or spend across tenants.
//
// EXEMPTION: the PUBLIC report route's receive-time lookup resolves by
// report_token — the CSPRNG token IS the capability (channel_webhooks doctrine),
// and the resolved row supplies the workspace every subsequent write scopes to.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "agents.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

// The receive-time capability lookup on the public report endpoint.
function isTokenLookup(sql: string): boolean {
  return /from\s+hired_agents\s+where\s+report_token\s*=\s*\?/i.test(sql.replace(/\s+/g, " "));
}

test("every agent-bridge query is workspace-scoped (the report-token lookup exempt)", () => {
  const touching = sqlBlocks.filter((s) =>
    /\b(from|into|update|delete\s+from)\s+(agent_fit_specs|hired_agents|agent_activity)\b/i.test(s)
  );
  assert.ok(touching.length >= 12, `expected >=12 agent-bridge queries, found ${touching.length}`);
  assert.ok(touching.some(isTokenLookup), "expected the report-token exemption to match something");
  for (const sql of touching.filter((s) => !isTokenLookup(s))) {
    assert.ok(/workspace_id/.test(sql), `an agent-bridge query is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`);
  }
});
