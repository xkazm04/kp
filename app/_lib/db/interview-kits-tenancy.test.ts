// TENANT SCOPE for the job-level interview kit (spark interview-kit-template, WP-A).
//
// `interview_kits` is job-keyed, and the jobs corpus is DUAL-TIER: a seeded corpus role
// carries workspace_id NULL and is visible to every tenant. That is exactly why this
// table gets NO by-id carve-out, unlike most point-read stores in this directory. Three
// facts make an unscoped read dangerous here:
//
//   * the kit is the team's own hiring judgement — which competencies the role is bought
//     on, what is asked about each, the FAQ they wrote — authored against their own LLM
//     spend, so a leaked kit id must not hand another team the questions they wrote;
//   * the by-id read is what a MINTED CANDIDATE LINK resolves (interview-kit.ts
//     `kitById`), so the id travels further than a recruiter's screen;
//   * two teams can hold kits for the SAME corpus role, so a job-only key would let one
//     team's publish decide what the other team's candidates are asked.
//
// Two halves, because either alone is a hollow guard: the STORE must actually filter, and
// the ROUTES must actually pass the tenant they resolved. The exemption list in the first
// test is literally empty and is meant to stay that way.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH before any store
// resolves db-path.ts).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { InterviewKit } from "../interview-kit-types.ts";

const {
  interviewKitAppendVersion,
  interviewKitById,
  interviewKitLatestDraft,
  interviewKitLatestPublished,
  interviewKitPublish,
  interviewKitVersions,
} = await import("./interview-kits.ts");
const { DEFAULT_WORKSPACE_ID } = await import("./workspaces.ts");

after(() => cleanupUnitDb());

const OTHER_WS = "team-beta";

function kit(title: string): InterviewKit {
  return {
    version: 1,
    competencies: [
      { id: "c1", title, weight: 3, budgetMin: 10, questions: [{ id: "c1q1", text: `What did you do about ${title}?`, mustAsk: true }] },
    ],
    faq: [],
  };
}

// ---- the SQL half ---------------------------------------------------------

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(dir, "interview-kits.ts"), "utf8").replace(/\r\n/g, "\n");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

test("every interview_kits statement binds workspace_id — no by-id exemption", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update)\s+interview_kits\b/i.test(s));
  assert.ok(touching.length >= 6, `expected every kit query, found ${touching.length}`);
  // The exemption list this guard grants. It is EMPTY on purpose (see the header); a
  // future entry has to state which point op is self-authorizing and why.
  const EXEMPT: readonly string[] = [];
  let inserts = 0;
  let predicates = 0;
  for (const sql of touching) {
    if (EXEMPT.some((e) => sql.includes(e))) continue;
    if (/\binsert\s+into\s+interview_kits\b/i.test(sql)) {
      // An INSERT STAMPS the tenant rather than filtering on it — the column has to be
      // in the list, or the row lands on the DDL's default and belongs to nobody.
      assert.match(sql, /\(\s*id,\s*workspace_id\b/i, `an interview_kits INSERT does not stamp workspace_id:\n${sql.trim()}`);
      inserts += 1;
      continue;
    }
    assert.match(
      sql,
      /workspace_id\s*=\s*\?/,
      `an interview_kits statement is NOT workspace-bound:\n${sql.trim().slice(0, 200)}`
    );
    predicates += 1;
  }
  // Non-vacuity: both shapes must actually have been seen, so a regex that stops matching
  // (a rewritten query, a renamed table) fails here rather than passing on an empty set.
  assert.ok(inserts >= 1, "expected the append INSERT");
  assert.ok(predicates >= 5, `expected every read/update to carry the predicate, saw ${predicates}`);
});

test("the version key is per (workspace, job), so two teams cannot renumber each other", () => {
  const core = readFileSync(path.join(dir, "core.ts"), "utf8").replace(/\r\n/g, "\n");
  assert.match(
    core,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_interview_kits_version ON interview_kits \(workspace_id, job_id, version\)/,
    "the uniqueness that makes 'version N' mean one thing must include the workspace"
  );
});

// ---- the behavioural half -------------------------------------------------

test("no read crosses a tenant boundary — latest-published, latest-draft, by-id, versions", () => {
  const foreign = interviewKitAppendVersion({ jobId: "kit-tenancy-job", kit: kit("Foreign secret"), source: "generated" }, OTHER_WS);
  interviewKitPublish(foreign.id, OTHER_WS);

  assert.equal(interviewKitLatestPublished("kit-tenancy-job", DEFAULT_WORKSPACE_ID), null);
  assert.equal(interviewKitLatestDraft("kit-tenancy-job", DEFAULT_WORKSPACE_ID), null);
  assert.equal(
    interviewKitById(foreign.id, DEFAULT_WORKSPACE_ID),
    null,
    "a leaked kit id is what a minted interview link carries — it must not resolve for another team"
  );
  assert.deepEqual(interviewKitVersions("kit-tenancy-job", DEFAULT_WORKSPACE_ID), []);

  // …and the scoping is a filter, not a wall: the owning team still reads its own.
  const own = interviewKitLatestPublished("kit-tenancy-job", OTHER_WS);
  assert.ok(own, "the owning team still reads its own published kit");
  assert.equal(own.kit.competencies[0].title, "Foreign secret");
  assert.equal(interviewKitVersions("kit-tenancy-job", OTHER_WS).length, 1);
});

test("a publish cannot cross a tenant boundary either", () => {
  const foreign = interviewKitAppendVersion({ jobId: "kit-publish-job", kit: kit("Theirs"), source: "generated" }, OTHER_WS);
  assert.equal(interviewKitPublish(foreign.id, DEFAULT_WORKSPACE_ID), null, "another team's draft must not be publishable");
  assert.equal(
    interviewKitById(foreign.id, OTHER_WS)?.status,
    "draft",
    "…and the refused publish must not have flipped the row on its way out"
  );
  assert.equal(interviewKitPublish(foreign.id, OTHER_WS)?.status, "published", "the owning team still publishes");
});

test("two teams keep independent version numbers for the SAME (shared corpus) role", () => {
  // The dual-tier case this table's scoping exists for: a seeded corpus job is visible to
  // everyone, so without the workspace in the key team B's first kit would be "version 2"
  // of team A's, and publishing it would decide what A's candidates are asked.
  const a = interviewKitAppendVersion({ jobId: "corpus-role", kit: kit("A"), source: "generated" }, DEFAULT_WORKSPACE_ID);
  const b = interviewKitAppendVersion({ jobId: "corpus-role", kit: kit("B"), source: "generated" }, OTHER_WS);
  assert.equal(a.version, 1);
  assert.equal(b.version, 1, "team B's first kit is its own version 1, not a continuation of team A's");
  interviewKitPublish(b.id, OTHER_WS);
  assert.equal(interviewKitLatestPublished("corpus-role", DEFAULT_WORKSPACE_ID), null, "B's publish says nothing about A's role");
});

// ---- the route half -------------------------------------------------------

test("every verb of the interview-kit routes passes the resolved workspace", () => {
  // The store's filtering is worthless if a handler calls a read unscoped: every function
  // here DEFAULTS its workspace, so an omitted argument silently serves the default team.
  // A source guard, because currentWorkspace() reads cookies and cannot be driven here;
  // comments are stripped so only executable text can satisfy it.
  const apiDir = path.join(dir, "..", "..", "api", "jobs", "[id]", "interview-kit");
  const strip = (s: string) =>
    s
      .replace(/\r\n/g, "\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  const collection = strip(readFileSync(path.join(apiDir, "route.ts"), "utf8"));
  const publish = strip(readFileSync(path.join(apiDir, "publish", "route.ts"), "utf8"));

  for (const [label, source, verbs] of [
    ["route.ts", collection, ["GET", "POST", "PUT"]],
    ["publish/route.ts", publish, ["POST"]],
  ] as const) {
    for (const verb of verbs) {
      const start = source.indexOf(`export async function ${verb}(`);
      assert.ok(start > 0, `${label}: ${verb} must exist`);
      const next = source.indexOf("export async function ", start + 1);
      const body = source.slice(start, next === -1 ? undefined : next);
      assert.match(body, /await currentWorkspace\(\)/, `${label}: ${verb} must resolve the caller's workspace`);
      // Every kit store call in the body must carry `ws` as its trailing argument.
      for (const call of body.matchAll(/interviewKit[A-Za-z]*\([^)]*\)/g)) {
        assert.match(call[0], /,\s*ws\s*\)$/, `${label}: ${verb} calls ${call[0]} without the resolved workspace`);
      }
    }
  }
});
