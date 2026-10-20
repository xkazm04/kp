// The Match results the SERVER holds (ADR 0018, 2026-10-07 amendment; pipeline write-doors
// scan, finding 1).
//
// POST /api/match used to answer and forget. A Match add then carried facts and a score
// the browser composed, and the add door could only check them for shape, so anyone who
// could reach the door sealed any verdict under any scorer version. Now every /api/match
// answer is recorded here, one row per (run, job), and the add door loads the row by
// `matchRunId` and refuses a Match add whose facts differ from it (app/api/pipeline/
// route.ts). No recompute and no Python at the add door: the add door stays a cheap write.
//
// What a row holds is the verdict FACTS the server derived from the engine's own output
// (fit tier, strongest/weakest dimension, up to three skill names per list, the score,
// the scorer version) beside the candidate id (a profile id / analysis slug) and the job
// id. That is candidate data, so the erasure scrub DELETEs a candidate's rows
// (db/pipeline.ts scrubEntryLinkedPii), pinned in erasure-full-scrub.test.ts.
//
// Tenancy: `match_run_results` is workspace-scoped; every statement binds workspace_id,
// so a run id from another team resolves to nothing (match-runs-tenancy.test.ts).

import { createHash, randomUUID } from "node:crypto";
import { ensureDb } from "./core";
import { coerceMatchReasonFacts, type MatchReasonFacts } from "../match-verdict";

/** How long a stored result can back an add: 12 hours. A recruiter ranks a candidate,
 *  re-weights, opens the cards and files over a working session, often with a break and a
 *  tab left open, so the window has to outlast a long day — a run that expired between
 *  "rank" and "file" would turn an honest add into a refusal. It stays short because the
 *  rows are candidate data held only to be checked against, not a record: the sealed
 *  decision-chain entry is the record. */
export const MATCH_RUN_TTL_MS = 12 * 60 * 60 * 1000;

/** The facts of one job's result, as /api/match derived them. */
export type MatchRunJobFacts = { jobId: string; facts: MatchReasonFacts };

/** A stable fingerprint of the sanitized weight override (key order does not matter);
 *  `baseline` when there is none. Part of the row's key: the weights change the total. */
export function matchWeightsHash(weights: Record<string, number> | null): string {
  if (!weights) return "baseline";
  const canonical = Object.keys(weights)
    .sort()
    .map((k) => [k, weights[k]]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 32);
}

/** Record one /api/match answer and return its run id. Results whose facts do not clear
 *  the strict coercer are not stored — an add of that job could not have passed it
 *  either. Expired rows are dropped on the way in, so the table cannot grow without
 *  bound and no sweeper is needed. */
export function recordMatchRun(args: {
  workspaceId: string;
  candidateId: string;
  weights: Record<string, number> | null;
  results: readonly MatchRunJobFacts[];
  now?: Date;
}): string {
  const db = ensureDb();
  const now = args.now ?? new Date();
  const runId = `mr-${randomUUID()}`;
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + MATCH_RUN_TTL_MS).toISOString();
  const weightsHash = matchWeightsHash(args.weights);
  const insert = db.prepare(
    `INSERT OR REPLACE INTO match_run_results
       (run_id, job_id, workspace_id, candidate_id, scorer_version, weights_hash, facts_json, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // Synchronous end to end (no await between BEGIN and COMMIT).
  db.transaction(() => {
    db.prepare(`DELETE FROM match_run_results WHERE expires_at <= ?`).run(createdAt);
    for (const { jobId, facts } of args.results) {
      const canonical = coerceMatchReasonFacts(facts);
      if (!canonical || !jobId) continue;
      insert.run(runId, jobId, args.workspaceId, args.candidateId, canonical.scorerVersion, weightsHash, JSON.stringify(canonical), createdAt, expiresAt);
    }
  })();
  return runId;
}

/** The facts the server holds for (run, job) in this workspace and for this candidate, or
 *  null when there is no such live row: unknown run, expired, another workspace's, or a
 *  run for a different candidate or job. One null on purpose — the caller's answer is the
 *  same ("run Match again") and a caller must not learn which of the four it was. */
export function loadMatchRunFacts(args: {
  workspaceId: string;
  runId: string;
  candidateId: string;
  jobId: string;
  now?: Date;
}): MatchReasonFacts | null {
  const row = ensureDb()
    .prepare(
      `SELECT facts_json FROM match_run_results
        WHERE run_id = ? AND job_id = ? AND workspace_id = ? AND candidate_id = ? AND expires_at > ?`
    )
    .get(args.runId, args.jobId, args.workspaceId, args.candidateId, (args.now ?? new Date()).toISOString()) as
    | { facts_json: string }
    | undefined;
  if (!row) return null;
  try {
    return coerceMatchReasonFacts(JSON.parse(row.facts_json));
  } catch {
    // A row that no longer parses cannot back an add: treated as missing.
    return null;
  }
}
