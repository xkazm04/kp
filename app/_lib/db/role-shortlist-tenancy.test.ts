// T14 / ADR 0030: the role shortlist. Four guarantees, one file:
//   - TENANCY: every role_shortlist statement binds workspace_id; another team can neither
//     read nor write a mark, and an entry on a different role is refused;
//   - ERASURE: anonymizeEntry deletes the candidate's marks and nobody else's;
//   - HUMAN-ONLY: the only code that writes the table is the store, the one route behind a
//     signed-in operator with the recruiter seat, and the erasure delete - no automation,
//     agent, scorer or LLM path can reach setShortlistState;
//   - the route derives the actor from the session, never from the request body.
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const store = await import("./role-shortlist.ts");
const { createPipelineEntry, anonymizeEntry } = await import("./pipeline.ts");
const { TENANCY_SCOPED_TABLES } = await import("../tenancy.ts");

after(() => cleanupUnitDb());

const A = "workspace";
const B = "team-beta";
const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const src = read(path.join(dir, "role-shortlist.ts"));
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

function entry(ws: string, job: string, label: string) {
  return createPipelineEntry({ candidateId: `c-${label}-${process.pid}`, candidateLabel: label, jobId: job, jobTitle: "Role", stage: "Interview", workspaceId: ws }).entry;
}

test("role_shortlist is classified workspace-scoped in the tenancy manifest", () => {
  assert.ok(TENANCY_SCOPED_TABLES.has("role_shortlist"));
});

test("every role_shortlist statement binds workspace_id", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update)\s+role_shortlist\b/i.test(s));
  assert.equal(touching.length, 3, "list, delete, upsert");
  for (const sql of touching) {
    if (/\binsert\s+into\b/i.test(sql)) assert.match(sql, /\(\s*workspace_id,/i, "the INSERT stamps the tenant");
    else assert.match(sql, /workspace_id\s*=\s*\?/, `unscoped statement:\n${sql.trim()}`);
  }
});

test("marks are per workspace: another team neither reads nor writes them", () => {
  const e = entry(A, "job-1", "Alice");
  assert.deepEqual(store.setShortlistState({ workspaceId: A, jobId: "job-1", entryId: e.id, state: "shortlisted", actor: "human:Sam" }).ok, true);
  assert.equal(store.listRoleShortlist(A, "job-1").length, 1);
  assert.deepEqual(store.listRoleShortlist(B, "job-1"), []);
  const foreign = store.setShortlistState({ workspaceId: B, jobId: "job-1", entryId: e.id, state: "chosen", actor: "human:Eve" });
  assert.deepEqual(foreign, { ok: false, code: "entry_unknown" });
  assert.equal(store.listRoleShortlist(A, "job-1")[0].state, "shortlisted", "the foreign write changed nothing");
  const wrongRole = store.setShortlistState({ workspaceId: A, jobId: "job-2", entryId: e.id, state: "chosen", actor: "human:Sam" });
  assert.deepEqual(wrongRole, { ok: false, code: "entry_unknown" });
});

test("a mark records who and when, upgrades to chosen, and clears", () => {
  const e = entry(A, "job-3", "Bea");
  store.setShortlistState({ workspaceId: A, jobId: "job-3", entryId: e.id, state: "shortlisted", actor: "human:Sam" });
  store.setShortlistState({ workspaceId: A, jobId: "job-3", entryId: e.id, state: "chosen", actor: "human:Kim" });
  const [row] = store.listRoleShortlist(A, "job-3");
  assert.equal(row.state, "chosen");
  assert.equal(row.setBy, "human:Kim");
  assert.ok(!Number.isNaN(Date.parse(row.setAt)));
  store.setShortlistState({ workspaceId: A, jobId: "job-3", entryId: e.id, state: null, actor: "human:Kim" });
  assert.deepEqual(store.listRoleShortlist(A, "job-3"), []);
});

test("erasing a candidate deletes their marks and only theirs", () => {
  const gone = entry(A, "job-4", "Cyril");
  const kept = entry(A, "job-4", "Dana");
  for (const e of [gone, kept]) store.setShortlistState({ workspaceId: A, jobId: "job-4", entryId: e.id, state: "chosen", actor: "human:Sam" });
  anonymizeEntry(gone.id, "erasure", A);
  assert.deepEqual(store.listRoleShortlist(A, "job-4").map((r) => r.entryId), [kept.id]);
});

// ---- human-only -----------------------------------------------------------

test("only the store, its one route and the erasure scrub write role_shortlist", () => {
  const appDir = path.resolve(dir, "..", "..");
  const allowed = new Set(
    [["_lib", "db", "role-shortlist.ts"], ["_lib", "db", "core.ts"], ["_lib", "db", "pipeline.ts"], ["api", "decisions", "shortlist", "route.ts"]].map((p) => p.join("/"))
  );
  const offenders: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(p);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(e.name) || /\.test\.tsx?$/.test(e.name)) continue;
      const rel = path.relative(appDir, p).split(path.sep).join("/");
      if (allowed.has(rel)) continue;
      const text = read(p);
      if (/\bsetShortlistState\b/.test(text) || /\b(insert\s+into|update|delete\s+from)\s+role_shortlist\b/i.test(text)) offenders.push(rel);
    }
  };
  walk(appDir);
  assert.deepEqual(offenders, [], "an automation/agent/scorer path reaches the shortlist writer");
  // Outside app/: the Python pipeline and edge worker must not write the table either.
  const repo = path.resolve(appDir);
  for (const sub of ["pipeline", "edge", "packages"]) {
    const root = path.join(repo, sub);
    const hits: string[] = [];
    const scan = (d: string) => {
      let entries;
      try {
        entries = readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name !== "node_modules" && e.name !== "__pycache__") scan(p);
        } else if (/\.(ts|py|mjs)$/.test(e.name) && /role_shortlist/.test(read(p))) hits.push(p);
      }
    };
    scan(root);
    assert.deepEqual(hits, [], `${sub}/ must not touch role_shortlist`);
  }
});

test("the route needs the recruiter seat and takes its actor from the session, not the body", () => {
  const route = read(path.join(dir, "..", "..", "api", "decisions", "shortlist", "route.ts"));
  assert.match(route, /export const POST = route\(withOperator\)/);
  assert.match(route, /requireCapabilityCoded\("pipeline:write", requireCapability\)/);
  assert.match(route, /actor: await humanActor\(\)/);
  assert.doesNotMatch(route, /body\??\.(actor|setBy|set_by|by)\b/);
});
