import { NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getJob, listMatrixProfiles, listOpenPositions, pipelinePlacements } from "@/app/_lib/db";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "@/app/_lib/python-runner";

export const runtime = "nodejs";

type Cell = { score: number | null; blocked: boolean };
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

// Candidate x open-position fit heatmap. Scores are deterministic (no LLM).
export async function GET() {
  let workdir: string | null = null;
  try {
    const profiles = listMatrixProfiles();
    const positions = listOpenPositions();
    if (profiles.length === 0 || positions.length === 0) {
      return NextResponse.json({ candidates: [], positions: [], cells: [], missing: [], missingCandidates: [], placements: {} });
    }

    workdir = await createWorkdir();
    const profilesPath = path.join(workdir, "profiles.json");
    await writeFile(profilesPath, JSON.stringify(profiles), "utf-8");

    const jobIds = positions.map((p) => p.id).join(",");
    // Open positions come from pipeline entries, which can reference DB-ingested jobs
    // absent from the static corpus. Pass those full records so they score instead of
    // silently vanishing from the grid; matrix_cli reports any still-unresolved ids.
    const dbJobs = positions.map((p) => getJob(p.id)).filter((j): j is NonNullable<typeof j> => j !== null);
    const jobsPath = path.join(workdir, "jobs.json");
    await writeFile(jobsPath, JSON.stringify(dbJobs), "utf-8");

    const { result } = spawnPython([
      "-m",
      "pipeline.jobfit.matrix_cli",
      "--profiles-json",
      profilesPath,
      "--job-ids",
      jobIds,
      "--jobs-json",
      jobsPath,
    ]);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    const matrix = parsePythonJson<MatrixOut>(stdout, stderr);
    // Re-attach titles to the unresolved ids so the grid can name the absent
    // positions rather than show opaque ids.
    const titleById = new Map(positions.map((p) => [p.id, p.title]));
    const missing = (matrix.missing ?? []).map((id) => ({ id, title: titleById.get(id) ?? id }));
    // matrix_cli already names the dropped candidates (id/label/error from the profile
    // payload itself), so unlike `missing` positions there is nothing to re-attach —
    // pass them straight through (defaulting for older CLI output).
    const missingCandidates = matrix.missingCandidates ?? [];
    return NextResponse.json({ ...matrix, missing, missingCandidates, placements: pipelinePlacements() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Matrix build failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
