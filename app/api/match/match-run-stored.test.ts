// POST /api/match persists each result it returns and answers with a `matchRunId`
// (ADR 0018 amendment; pipeline write-doors scan, finding 1), so POST /api/pipeline can
// check a Match add against a result the SERVER holds.
//
// Drives the REAL handler and the REAL engine (match_cli is deterministic and keyless),
// the way engine-busy.test.ts reaches the route: an analysis is saved, the route is
// posted, and the stored rows are read back through the store. The response is otherwise
// the engine's own answer.
//
// unit-db.ts must stay the FIRST project import.
// Run: node scripts/run-unit-tests.mjs "app/api/match/match-run-stored.test.ts"
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope; the route only needs "no
// cookie, no header" (open mode, default workspace).
const VIRTUAL_HEADERS = "kp-test:match-run-headers";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: VIRTUAL_HEADERS, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_HEADERS) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export async function cookies() { return { get: () => undefined }; }
          export async function headers() { return new Headers(); }
          export async function draftMode() { return { isEnabled: false }; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

process.env.KP_LLM_USAGE_LOG = "0";

const { NextRequest } = await import("next/server");
const { POST } = await import("./route.ts");
const { saveAnalysis } = await import("../../_lib/db/analyses.ts");
const { ensureDb } = await import("../../_lib/db/core.ts");
const { loadMatchRunFacts, matchWeightsHash } = await import("../../_lib/db/match-runs.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../_lib/db/workspaces.ts");
const { matchReasonFacts } = await import("../../features/insights/matrix/focus/matchReasons.ts");

after(() => cleanupUnitDb());

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/match", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

const { slug } = saveAnalysis({
  candidateLabel: "Match Run Subject",
  jdSlug: null,
  score: 70,
  roleFamily: "software_engineering",
  seniority: "mid",
  payload: {
    candidate: { name: "Match Run Subject", skills: ["Python", "SQL", "Docker"], currentSeniority: "mid", roleFamily: "software_engineering", yearsExperience: 4 },
    score: 70,
  },
});

test("/api/match returns a matchRunId and stores the run, one row per returned job", async () => {
  const res = await post({ analysisSlug: slug, limit: 5 });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { matchRunId?: string; matches: { jobId: string; total: number }[]; meta: unknown };
  assert.match(body.matchRunId ?? "", /^mr-[0-9a-f-]{36}$/);
  assert.ok(body.matches.length > 0, "the engine ranked at least one role");
  assert.ok(body.meta, "the response is otherwise the engine's own answer");

  const rows = ensureDb()
    .prepare(`SELECT job_id, candidate_id, workspace_id, weights_hash FROM match_run_results WHERE run_id = ?`)
    .all(body.matchRunId) as { job_id: string; candidate_id: string; workspace_id: string; weights_hash: string }[];
  assert.equal(rows.length, body.matches.length);
  for (const r of rows) {
    assert.equal(r.candidate_id, slug);
    assert.equal(r.workspace_id, DEFAULT_WORKSPACE_ID);
    assert.equal(r.weights_hash, matchWeightsHash(null));
  }
  // What is stored is what the SERVER derived from the engine's output — the facts a
  // Match add must then carry.
  for (const m of body.matches) {
    const held = loadMatchRunFacts({ workspaceId: DEFAULT_WORKSPACE_ID, runId: body.matchRunId!, candidateId: slug, jobId: m.jobId });
    assert.deepEqual(held, matchReasonFacts(m as never), `stored facts for ${m.jobId}`);
    assert.equal(held!.matchScore, m.total);
  }
});

test("a weight override is part of the run's key, and a run is a fresh id each time", async () => {
  const a = (await (await post({ analysisSlug: slug, limit: 3 })).json()) as { matchRunId: string };
  const b = (await (await post({ analysisSlug: slug, limit: 3, weights: { skills: 70, career: 20, personal: 10 } })).json()) as { matchRunId: string };
  assert.notEqual(a.matchRunId, b.matchRunId);
  const hashes = ensureDb()
    .prepare(`SELECT DISTINCT weights_hash FROM match_run_results WHERE run_id IN (?, ?) ORDER BY weights_hash`)
    .all(a.matchRunId, b.matchRunId) as { weights_hash: string }[];
  assert.equal(hashes.length, 2, "baseline and overridden runs carry different weight fingerprints");
});

test("an inline candidate cannot be filed, so its run is not stored and carries no id", async () => {
  const res = await post({ candidate: { skills: ["Python"], seniority: "mid", roleFamily: "software_engineering", archetype: "bau" }, limit: 3 });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { matchRunId?: string }).matchRunId, undefined);
});

test("the facts the Match client derives from the response are exactly the ones the add door accepts", async () => {
  const { POST: addToBoard } = await import("../pipeline/route.ts");
  const { matchScoreForPipeline } = await import("../../features/shared/matchTypes.ts");
  const run = (await (await post({ analysisSlug: slug, limit: 2 })).json()) as {
    matchRunId: string;
    matches: { jobId: string; title: string; total: number }[];
  };
  const m = run.matches[0];
  const add = (over: Record<string, unknown> = {}) =>
    addToBoard(
      new NextRequest("http://localhost/api/pipeline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          candidateId: slug,
          candidateLabel: "Match Run Subject",
          jobId: m.jobId,
          jobTitle: m.title,
          matchScore: matchScoreForPipeline(m.total),
          stage: "Screened",
          source: "match",
          approvalKind: "decision",
          matchFacts: matchReasonFacts(m as never),
          matchRunId: run.matchRunId,
          ...over,
        }),
      })
    );
  const forged = { ...matchReasonFacts(m as never), matchScore: 100 };
  const refused = await add({ matchScore: 100, matchFacts: forged });
  assert.equal(refused.status, 409);
  assert.equal(((await refused.json()) as { code: string }).code, "PIPELINE_ADD_MATCH_RUN_MISMATCH");
  const filed = await add();
  assert.equal(filed.status, 200);
});
