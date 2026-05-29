import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAnalysis } from "@/app/_lib/db";
import {
  cleanupWorkdir,
  createWorkdir,
  parseStderrError,
  spawnPython,
} from "@/app/_lib/python-runner";

export const runtime = "nodejs";

type CandidateInput = {
  skills?: string[];
  seniority?: string;
  roleFamily?: string;
  educationLevel?: string;
  languages?: string[];
  yearsExperience?: number;
  traits?: string[];
  preferredWorkModes?: string[];
  archetype?: string;
  label?: string;
};

export async function POST(request: NextRequest) {
  let workdir: string | null = null;
  try {
    const body = (await request.json()) as {
      analysisSlug?: string;
      candidate?: CandidateInput;
      limit?: number;
    };
    const limit = typeof body.limit === "number" ? body.limit : 50;

    let candidate: CandidateInput | null = body.candidate ?? null;
    if (body.analysisSlug) {
      const loaded = loadAnalysis(body.analysisSlug);
      if (!loaded) {
        return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
      }
      const payload = loaded.payload as { candidate?: Record<string, unknown> };
      const c = payload?.candidate ?? {};
      candidate = {
        skills: (c.skills as string[]) ?? [],
        seniority: (c.currentSeniority as string) ?? "medior",
        roleFamily: (c.roleFamily as string) ?? "software_engineering",
        educationLevel: (c.educationLevel as string) ?? "unknown",
        languages: (c.languages as string[]) ?? [],
        yearsExperience: (c.yearsExperience as number) ?? 0,
        traits: (c.traits as string[]) ?? [],
        label: loaded.row.candidate_label ?? (c.name as string) ?? "Candidate",
      };
    }

    if (!candidate) {
      return NextResponse.json(
        { error: "Provide an analysisSlug or an inline candidate." },
        { status: 400 }
      );
    }

    workdir = await createWorkdir();
    const candidatePath = path.join(workdir, "candidate.json");
    await writeFile(candidatePath, JSON.stringify(candidate), "utf-8");

    const { result } = spawnPython([
      "-m",
      "pipeline.jobfit.match_cli",
      "--candidate-json",
      candidatePath,
      "--limit",
      String(limit),
    ]);
    const { stdout, stderr, exitCode } = await result;

    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Match failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
