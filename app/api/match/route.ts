import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getProfileRecord } from "@/app/_lib/db";
import { resolveCandidate, type CandidateInput } from "@/app/_lib/match-candidate";
import {
  cleanupWorkdir,
  createWorkdir,
  parseStderrError,
  spawnPython,
} from "@/app/_lib/python-runner";

export const runtime = "nodejs";

// match() does scored[:limit] in Python, so the limit must be a sane positive
// integer: a negative value silently drops the last N matches, 0 returns nothing
// while meta still reports survivors, and a float raises an opaque TypeError.
// Coerce + clamp at this boundary so "whatever the client sends" becomes a
// defined 1..200 contract (default 50).
const MATCH_LIMIT_DEFAULT = 50;
const MATCH_LIMIT_MIN = 1;
const MATCH_LIMIT_MAX = 200;

function resolveMatchLimit(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return MATCH_LIMIT_DEFAULT;
  return Math.min(MATCH_LIMIT_MAX, Math.max(MATCH_LIMIT_MIN, Math.floor(raw)));
}

export async function POST(request: NextRequest) {
  let workdir: string | null = null;
  try {
    const body = (await request.json()) as {
      analysisSlug?: string;
      candidate?: CandidateInput;
      profileId?: string;
      limit?: number;
    };
    const limit = resolveMatchLimit(body.limit);

    workdir = await createWorkdir();
    let args: string[];

    if (body.profileId) {
      // v2 profile: hand the raw CandidateProfileV2 to Python, which transforms it
      // (skills+provenance, potential) into a MatchCandidate before matching.
      const record = getProfileRecord(body.profileId);
      if (!record) {
        return NextResponse.json({ error: "Profile not found." }, { status: 404 });
      }
      const profilePath = path.join(workdir, "profile.json");
      await writeFile(profilePath, JSON.stringify(record.payload), "utf-8");
      args = ["-m", "pipeline.jobfit.match_cli", "--profile-json", profilePath, "--limit", String(limit)];
    } else {
      const resolved = resolveCandidate(body);
      if ("error" in resolved) {
        return NextResponse.json({ error: resolved.error }, { status: resolved.status });
      }
      const candidatePath = path.join(workdir, "candidate.json");
      await writeFile(candidatePath, JSON.stringify(resolved.candidate), "utf-8");
      args = ["-m", "pipeline.jobfit.match_cli", "--candidate-json", candidatePath, "--limit", String(limit)];
    }

    const { result } = spawnPython(args);
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
