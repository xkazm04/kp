import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { listCorpusJobs } from "@/app/_lib/db";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { writeMatchInput, type MatchInputBody } from "@/app/_lib/match-input";
import {
  cleanupWorkdir,
  createWorkdir,
  parsePythonJson,
  parseStderrError,
  spawnPython,
} from "@/app/_lib/python-runner";


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
    const body = (await request.json()) as MatchInputBody & { limit?: number; weights?: unknown };
    const limit = resolveMatchLimit(body.limit);

    workdir = await createWorkdir();
    const input = await writeMatchInput(body, workdir);
    if ("error" in input) {
      return NextResponse.json({ error: input.error }, { status: input.status });
    }
    const args = ["-m", "pipeline.jobfit.match_cli", ...input.inputArgs, "--limit", String(limit)];
    // A recruiter-ingested/published job never reaches the static seed corpus the
    // CLI reads, so it was scored by the Fit Matrix yet absent from the Match tab
    // at any rank. Hand the live DB corpus over as --jobs-json overrides (DB wins
    // on id collision) — mirrors /api/matrix's --jobs-json and rematch's
    // live-corpus hand-off in automation-run.ts.
    const corpusJobs = listCorpusJobs(await currentWorkspace());
    if (corpusJobs.length > 0) {
      const jobsPath = path.join(workdir, "jobs.json");
      await writeFile(jobsPath, JSON.stringify(corpusJobs), "utf-8");
      args.push("--jobs-json", jobsPath);
    }
    // Recruiter weight override (MAT1): forwarded as a JSON arg only when it's a
    // plain object of finite numbers. The Python scorer clamps it to the
    // archetype's bounds + renormalizes, so the client can't push an out-of-range
    // or non-summing vector; anything malformed falls back to the baseline there too.
    if (body.weights && typeof body.weights === "object" && !Array.isArray(body.weights)) {
      const w: Record<string, number> = {};
      for (const [k, v] of Object.entries(body.weights as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isFinite(v)) w[k] = v;
      }
      if (Object.keys(w).length > 0) args.push("--weights", JSON.stringify(w));
    }

    // Forward the request's abort signal so an abandoned request SIGKILLs the child
    // (and reaches the finally → cleanupWorkdir) instead of orphaning it to the 600s
    // backstop and leaking the temp dir — the leak extract-text already guards against.
    const { result } = spawnPython(args, { signal: request.signal });
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // parsePythonJson, not raw JSON.parse (idea-37493de3): the CLIs can print
    // stray non-JSON to stdout AFTER the result line (asyncio shutdown chatter,
    // ResourceWarnings) — a successful match must not be reported as a 500
    // because the interpreter logged a teardown notice.
    return NextResponse.json(parsePythonJson<Record<string, unknown>>(stdout, stderr));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Match failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
