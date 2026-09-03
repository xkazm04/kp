import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getJobsByIds } from "@/app/_lib/db/jobs";
import { countMatrixProfiles, listMatrixProfiles, listOpenPositions, MATRIX_POOL_CAP, pipelinePlacements } from "@/app/_lib/db/profiles";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "@/app/_lib/python-runner";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { matrixEngineAnswer, MATRIX_GRID_SURFACE } from "./matrix-error-code";


// koKeys: stable KoReason.key categories naming WHY a cell is blocked (MAT2);
// present only on blocked cells, localized client-side by key.
type Cell = { score: number | null; blocked: boolean; koKeys?: string[] };
type MatrixOut = {
  candidates: { id: string; label: string; archetype: string | null }[];
  positions: { id: string; title: string; seniority: string; roleFamily: string; salaryBand: number[] }[];
  cells: Cell[][];
  // Requested position ids that matched neither the static corpus nor a DB job —
  // surfaced so the grid can flag the gap instead of silently dropping the column.
  missing: string[];
  // Profiles dropped because their CandidateProfileV2 failed to validate/transform —
  // surfaced (with the error) so a vanished candidate row is explained, not swallowed.
  missingCandidates: { id: string; label: string; error: string }[];
};

// Single-entry, content-addressed cache for the scored grid (idea-4b0dfc70).
// The matrix is a DETERMINISTIC O(N*M) computation behind a Python process
// spawn, and it was rebuilt from scratch on every visit to a frequently-
// revisited tab. The key is a hash of the EXACT JSON handed to the scorer
// (profiles + requested ids + job records) — profiles/jobs carry no updated_at
// column, so content-addressing the real inputs is the only edit-safe
// invalidation, mirroring the reasoning cache's content-hash contract. The
// stringify cost paid on a hit is the same stringify a miss needs for
// writeFile, i.e. the hit path does strictly less work. In-process single
// entry by design (one corpus state matters; kp runs one server process).
let matrixCache: { key: string; matrix: MatrixOut } | null = null;

// Candidate x open-position fit heatmap. Scores are deterministic (no LLM).
export async function GET(request: NextRequest) {
  let workdir: string | null = null;
  try {
    const ws = await currentWorkspace();
    const profiles = listMatrixProfiles(MATRIX_POOL_CAP, ws);
    // The unclamped pool size, so the grid can say "Showing 200 of N" instead of
    // silently omitting candidates past the cap (skill-matrix-coverage #1).
    const poolTotal = countMatrixProfiles(ws);
    const positions = listOpenPositions(ws);
    if (profiles.length === 0 || positions.length === 0) {
      return NextResponse.json({ candidates: [], positions: [], cells: [], missing: [], missingCandidates: [], placements: {}, poolTotal, poolCap: MATRIX_POOL_CAP });
    }

    const profilesJson = JSON.stringify(profiles);
    const jobIds = positions.map((p) => p.id).join(",");
    // Open positions come from pipeline entries, which can reference DB-ingested jobs
    // absent from the static corpus. Pass those full records so they score instead of
    // silently vanishing from the grid; matrix_cli reports any still-unresolved ids.
    // One IN-query for the whole position set (idea-f946db9d) — this sat on the
    // matrix critical path as M point SELECTs before Python even started.
    const dbJobs = getJobsByIds(
      positions.map((p) => p.id),
      // Tenant scope: the batch now filters (workspace_id IS NULL OR = ?) itself rather
      // than trusting that its ids were laundered through a scoped list first.
      ws
    );
    const jobsJson = JSON.stringify(dbJobs);

    // Re-attach titles to unresolved ids + fetch placements on EVERY response
    // (cached or not): placements move with each stage change and are a cheap
    // read — only the spawn+scoring is cached.
    const titleById = new Map(positions.map((p) => [p.id, p.title]));
    const respond = (matrix: MatrixOut, cached: boolean) =>
      NextResponse.json({
        ...matrix,
        missing: (matrix.missing ?? []).map((id) => ({ id, title: titleById.get(id) ?? id })),
        // matrix_cli already names the dropped candidates (id/label/error from the
        // profile payload itself) — pass straight through (defaulting for older CLI output).
        missingCandidates: matrix.missingCandidates ?? [],
        placements: pipelinePlacements(ws),
        // Pool-size signal (fresh each response, outside the scored-grid cache) so
        // the UI can flag a truncated pool alongside the missing/missingCandidates banners.
        poolTotal,
        poolCap: MATRIX_POOL_CAP,
        cached,
      });

    const key = createHash("sha1")
      .update(profilesJson)
      .update("\u0000")
      .update(jobIds)
      .update("\u0000")
      .update(jobsJson)
      .digest("hex");
    if (matrixCache?.key === key) return respond(matrixCache.matrix, true);

    workdir = await createWorkdir();
    const profilesPath = path.join(workdir, "profiles.json");
    await writeFile(profilesPath, profilesJson, "utf-8");
    const jobsPath = path.join(workdir, "jobs.json");
    await writeFile(jobsPath, jobsJson, "utf-8");

    const { result } = spawnPython(
      [
        "-m",
        "pipeline.jobfit.matrix_cli",
        "--profiles-json",
        profilesPath,
        "--job-ids",
        jobIds,
        "--jobs-json",
        jobsPath,
      ],
      // Abandoned request SIGKILLs the child + reaches finally→cleanupWorkdir instead
      // of orphaning it to the 600s backstop and leaking the temp dir.
      { signal: request.signal }
    );
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      // matrix-answers-with-codes-and-retries: the runner's machine code, not its
      // message. matrix_cli's stderr carries the temp workdir path and a Python
      // traceback; the grid needs a code it can localize, not that.
      const answer = matrixEngineAnswer(err, MATRIX_GRID_SURFACE);
      return answer.kind === "refusal"
        ? jsonRefusal(answer.code, err.status)
        : safeJsonError(new Error(err.message), "api:matrix", answer.code, err.status);
    }

    const matrix = parsePythonJson<MatrixOut>(stdout, stderr);
    matrixCache = { key, matrix };
    return respond(matrix, false);
  } catch (error) {
    // better-sqlite3, fs and the spawn itself all throw with internal detail in
    // `.message` (the db path, the temp workdir) — logged, never forwarded.
    return safeJsonError(error, "api:matrix", "MATRIX_BUILD_FAILED");
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
