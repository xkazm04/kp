import { NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { listMatrixProfiles, listOpenPositions, pipelinePlacements } from "@/app/_lib/db";
import { cleanupWorkdir, createWorkdir, parseStderrError, spawnPython } from "@/app/_lib/python-runner";

export const runtime = "nodejs";

type Cell = { score: number | null; blocked: boolean };
type MatrixOut = {
  candidates: { id: string; label: string; archetype: string | null }[];
  positions: { id: string; title: string; seniority: string; roleFamily: string; salaryBand: number[] }[];
  cells: Cell[][];
};

// Candidate x open-position fit heatmap. Scores are deterministic (no LLM).
export async function GET() {
  let workdir: string | null = null;
  try {
    const profiles = listMatrixProfiles();
    const positions = listOpenPositions();
    if (profiles.length === 0 || positions.length === 0) {
      return NextResponse.json({ candidates: [], positions: [], cells: [], placements: {} });
    }

    workdir = await createWorkdir();
    const profilesPath = path.join(workdir, "profiles.json");
    await writeFile(profilesPath, JSON.stringify(profiles), "utf-8");

    const jobIds = positions.map((p) => p.id).join(",");
    const { result } = spawnPython(["-m", "pipeline.jobfit.matrix_cli", "--profiles-json", profilesPath, "--job-ids", jobIds]);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    const matrix = JSON.parse(stdout) as MatrixOut;
    return NextResponse.json({ ...matrix, placements: pipelinePlacements() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Matrix build failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
