import { NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getJob,
  getProfileRecord,
  listAnalyses,
  listProfiles,
  loadAnalysis,
} from "@/app/_lib/db";
import {
  cleanupWorkdir,
  createWorkdir,
  parseStderrError,
  spawnPython,
} from "@/app/_lib/python-runner";

export const runtime = "nodejs";

type CandidateEntry =
  | { id: string; label: string; profile: unknown }
  | { id: string; label: string; candidate: Record<string, unknown> };

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let workdir: string | null = null;
  try {
    if (!getJob(id)) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    const entries: CandidateEntry[] = [];

    // v2 profiles -> Python transforms them (skills+provenance, potential).
    for (const p of listProfiles(100)) {
      const rec = getProfileRecord(p.id);
      if (rec) entries.push({ id: p.id, label: p.label, profile: rec.payload });
    }

    // saved CV analyses -> prefer the archetype-routed v2 profile (Python
    // transforms it with skills+provenance + a potential score, so a student /
    // switcher is scored fairly). Fall back to the flat BAU candidate only for
    // older analyses saved before v2 profiles existed.
    for (const a of listAnalyses(60)) {
      const loaded = loadAnalysis(a.slug);
      if (!loaded) continue;
      const payload = loaded.payload as {
        candidate?: Record<string, unknown>;
        v2Profile?: Record<string, unknown>;
      };
      if (payload.v2Profile && Object.keys(payload.v2Profile).length > 0) {
        entries.push({ id: a.slug, label: a.candidate_label, profile: payload.v2Profile });
        continue;
      }
      const c = payload.candidate ?? {};
      entries.push({
        id: a.slug,
        label: a.candidate_label,
        candidate: {
          skills: (c.skills as string[]) ?? [],
          seniority: (c.currentSeniority as string) ?? "medior",
          roleFamily: (c.roleFamily as string) ?? "software_engineering",
          educationLevel: (c.educationLevel as string) ?? "unknown",
          languages: (c.languages as string[]) ?? [],
          yearsExperience: (c.yearsExperience as number) ?? 0,
          archetype: "bau",
        },
      });
    }

    if (entries.length === 0) {
      return NextResponse.json({ job: null, candidates: [], note: "No saved candidates yet." });
    }

    workdir = await createWorkdir();
    const inputPath = path.join(workdir, "recruiter.json");
    await writeFile(inputPath, JSON.stringify({ jobId: id, candidates: entries }), "utf-8");

    const { result } = spawnPython(["-m", "pipeline.jobfit.recruiter_cli", "--input-json", inputPath]);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(JSON.parse(stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to rank candidates.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
