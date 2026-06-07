import { NextRequest, NextResponse } from "next/server";
import { writeMatchInput, type MatchInputBody } from "@/app/_lib/match-input";
import {
  cleanupWorkdir,
  createWorkdir,
  parsePythonJson,
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
    const body = (await request.json()) as MatchInputBody & { limit?: number };
    const limit = resolveMatchLimit(body.limit);

    workdir = await createWorkdir();
    const input = await writeMatchInput(body, workdir);
    if ("error" in input) {
      return NextResponse.json({ error: input.error }, { status: input.status });
    }
    const args = ["-m", "pipeline.jobfit.match_cli", ...input.inputArgs, "--limit", String(limit)];

    const { result } = spawnPython(args);
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
