// TENANT SCOPE for Cohort Studio (spark analyze-v2-cohort, WP2): `analysis_cohorts`.
//
// A cohort holds a shortlist of NAMED people compared against one team's role, and its id
// travels through the URL and through the task runner's replayable params. So, like
// interview_letters, the table gets NO by-id carve-out: every statement binds
// workspace_id, point reads included. Two halves, because either alone is hollow:
//   - the SQL half: the store binds the tenant, and nothing outside it but the erasure
//     scrub reaches the table;
//   - the behavioural half: another workspace can neither READ a cohort nor START one
//     over foreign members or a foreign JD (the resolvers the POST route uses answer
//     nothing for them), and the proposal for a foreign JD does not exist.
//
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const store = await import("./analysis-cohorts.ts");
const { saveAnalysis } = await import("./analyses.ts");
const { saveJd } = await import("./jobs.ts");
const { TENANCY_SCOPED_TABLES } = await import("../tenancy.ts");
const proposal = await import("../analyze-cohort-proposal.ts");

after(() => cleanupUnitDb());

const A = "workspace";
const B = "team-beta";

// ---- the SQL half ---------------------------------------------------------

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(dir, "analysis-cohorts.ts"), "utf8").replace(/\r\n/g, "\n");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

test("analysis_cohorts is classified workspace-scoped in the tenancy manifest", () => {
  assert.ok(TENANCY_SCOPED_TABLES.has("analysis_cohorts"));
});

test("every analysis_cohorts statement binds workspace_id — no by-id exemption", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update)\s+analysis_cohorts\b/i.test(s));
  assert.ok(touching.length >= 7, `expected every cohort query, found ${touching.length}`);
  let inserts = 0;
  for (const sql of touching) {
    if (/\binsert\s+into\s+analysis_cohorts\b/i.test(sql)) {
      assert.match(sql, /\(\s*id,\s*workspace_id\b/i, `a cohort INSERT does not stamp workspace_id:\n${sql.trim()}`);
      inserts += 1;
      continue;
    }
    assert.match(sql, /workspace_id\s*=\s*\?/, `an analysis_cohorts statement is NOT workspace-bound:\n${sql.trim().slice(0, 200)}`);
  }
  assert.equal(inserts, 1, "one INSERT, and it stamps the tenant");
});

test("the store's narrow reads over analyses/profiles bind the tenant too", () => {
  const reads = sqlBlocks.filter((s) => /\bfrom\s+(analyses|profiles)\b/i.test(s));
  assert.equal(reads.length, 3, "cv facts, profile facts, reuse rows");
  for (const sql of reads) assert.match(sql, /workspace_id\s*=\s*\?/, `unscoped read:\n${sql.trim().slice(0, 200)}`);
  // …and none of them can put the CV or the payload on the wire.
  for (const sql of reads) assert.doesNotMatch(sql.replace(/json_extract\(payload_json[^)]*\)/g, ""), /payload_json\s*(,|FROM)/i);
});

test("no store export defaults its workspace (the route ratchet reads names by text)", () => {
  for (const m of src.matchAll(/export function (\w+)\(([^)]*)\)/g)) {
    assert.doesNotMatch(m[2], /workspaceId\s*:\s*string\s*=/, `${m[1]} defaults its workspace`);
    if (/workspaceId/.test(m[2])) assert.match(m[1], /AnalysisCohort/, `${m[1]} must carry the AnalysisCohort name`);
  }
});

test("outside this store, only the erasure scrub writes the table", () => {
  const libDir = path.resolve(dir, "..");
  const appDir = path.resolve(libDir, "..");
  const offenders: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(p);
        continue;
      }
      if (!e.name.endsWith(".ts") || e.name.endsWith(".test.ts")) continue;
      if (p === path.join(dir, "analysis-cohorts.ts") || p === path.join(dir, "core.ts")) continue;
      const text = readFileSync(p, "utf8");
      for (const m of text.matchAll(/`([^`]*)`/g)) {
        if (/\b(from|into|update)\s+analysis_cohorts\b/i.test(m[1])) offenders.push(`${path.relative(appDir, p)}: ${m[1].trim().slice(0, 90)}`);
      }
    }
  };
  walk(appDir);
  assert.deepEqual(
    [...new Set(offenders.map((o) => o.split(":")[0]))],
    [path.join("_lib", "db", "pipeline.ts")],
    `only the erasure scrub may touch analysis_cohorts outside its store:\n${offenders.join("\n")}`
  );
});

// ---- the behavioural half -------------------------------------------------

function analysis(ws: string, label: string, jdSlug: string | null = null) {
  return saveAnalysis(
    {
      candidateLabel: label,
      jdSlug,
      score: 70,
      roleFamily: "software_engineering",
      seniority: "medior",
      payload: { candidate: { name: label, rawText: `${label} — eight years of Python services.`, roleFamily: "software_engineering" } },
      cvHash: `hash-${ws}-${label}`,
    },
    ws
  ).slug;
}

test("another workspace cannot read, list or move a cohort", () => {
  const slug = analysis(A, "Tenant Alice");
  const rec = store.createAnalysisCohort(
    { jdSlug: "jd-x", blind: false, reportLang: "en", members: [{ memberId: slug, label: "Tenant Alice", membership: "matched", source: { kind: "analysis", slug } }] },
    A
  );
  assert.ok(store.getAnalysisCohort(rec.id, A), "the owner reads it");
  assert.equal(store.getAnalysisCohort(rec.id, B), null, "a foreign team's point read is nothing");
  assert.equal(store.listRecentAnalysisCohorts(B).some((c) => c.id === rec.id), false, "nor in its strip");
  assert.equal(store.setAnalysisCohortStatus(rec.id, "done", B), false, "nor can it finish it");
  assert.equal(store.setAnalysisCohortTask(rec.id, "t-x", B), false);
  assert.equal(store.setAnalysisCohortComments(rec.id, { cells: [], notes: {}, narrative: null }, B), false);
  assert.equal(store.updateAnalysisCohortMember(rec.id, slug, { runState: "failed" }, B), false, "nor move a member");
  assert.equal(store.getAnalysisCohort(rec.id, A)?.status, "queued", "the owner's row is untouched");
  assert.equal(store.getAnalysisCohort(rec.id, A)?.members[0].runState, "queued");
});

test("a cohort cannot be STARTED over another workspace's members", () => {
  const foreign = analysis(B, "Beta Bara");
  const own = analysis(A, "Alpha Ales");
  const readers = {
    cvFacts: store.listAnalysisCohortCvFacts,
    profileFacts: store.listAnalysisCohortProfileFacts,
    withholdsPii: () => false,
  };
  const resolved = proposal.resolveCohortSources([own, foreign, "profile:nope"], A, readers);
  assert.ok(resolved.get(own), "the caller's own analysis resolves");
  assert.equal(resolved.get(foreign), null, "another team's analysis does not — the POST answers COHORT_MEMBER_NOT_FOUND");
  assert.equal(resolved.get("profile:nope"), null);
});

test("a cohort cannot be started (or proposed) over another workspace's JD", async () => {
  const { slug: jd } = saveJd({ title: "Beta role", body: "Python services." }, B);
  const jdDeps = proposal.cohortJdDeps();
  assert.ok(proposal.cohortJdContext(jd, B, jdDeps), "the owner sees its JD");
  assert.equal(proposal.cohortJdContext(jd, A, jdDeps), null, "the POST answers JD_NOT_FOUND for a foreign JD");
  const never = () => {
    throw new Error("a foreign JD must never reach the pool or the ranker");
  };
  const proposed = await proposal.buildCohortProposal(jd, A, {
    ...proposal.cohortSourceReaders(),
    ...jdDeps,
    listApplicants: never,
    poolEntryExists: never,
    buildPool: never,
    rankPool: async () => never(),
    reuseRows: never,
  });
  assert.equal(proposed, null, "…and the proposal route answers JD_NOT_FOUND");
});

test("the reuse rows and CV facts of one team are invisible to another", () => {
  const slug = analysis(A, "Reuse Rita", "cohort-role-a");
  assert.equal(store.listAnalysisCohortReuseRows("cohort-role-a", B).length, 0);
  assert.equal(store.listAnalysisCohortReuseRows("cohort-role-a", A)[0]?.slug, slug);
  assert.equal(store.listAnalysisCohortCvFacts([slug], B).size, 0);
});
