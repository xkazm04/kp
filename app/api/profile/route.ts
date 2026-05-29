import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { listProfiles, saveProfile } from "@/app/_lib/db";
import {
  cleanupWorkdir,
  createWorkdir,
  parseStderrError,
  spawnPython,
} from "@/app/_lib/python-runner";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ profiles: listProfiles(200) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list profiles.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let workdir: string | null = null;
  try {
    const body = (await request.json()) as {
      profile?: Record<string, unknown>;
      signals?: Record<string, unknown>;
      persist?: boolean;
    };

    workdir = await createWorkdir();
    const inputPath = path.join(workdir, "intake.json");
    await writeFile(
      inputPath,
      JSON.stringify({ profile: body.profile ?? {}, signals: body.signals ?? {} }),
      "utf-8"
    );

    const { result } = spawnPython(["-m", "pipeline.jobfit.profile_cli", "--input-json", inputPath]);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    const data = JSON.parse(stdout) as {
      profile: Record<string, unknown>;
      archetype: string;
      completeness: number;
    };

    // Persist by default; the form can request a dry-run preview with persist:false.
    if (body.persist === false) {
      return NextResponse.json({ ...data, saved: null });
    }
    const profile = data.profile;
    const saved = saveProfile({
      label: (profile.displayName as string) || "Candidate",
      archetype: data.archetype ?? null,
      roleFamily: (profile.roleFamily as string) ?? null,
      completeness: data.completeness ?? null,
      payload: profile,
    });
    return NextResponse.json({ ...data, saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Profile build failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
