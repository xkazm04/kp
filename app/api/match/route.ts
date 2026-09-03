import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { listCorpusJobs } from "@/app/_lib/db/jobs";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { writeMatchInput, type MatchInputBody } from "@/app/_lib/match-input";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { matrixEngineAnswer, MATCH_RUN_SURFACE } from "@/app/api/matrix/matrix-error-code";
import { resolveMatchLimit, sanitizeMatchWeights } from "./match-request";
import {
  cleanupWorkdir,
  createWorkdir,
  parsePythonJson,
  parseStderrError,
  spawnPython,
} from "@/app/_lib/python-runner";


// The limit clamp and the weights sanitizer live in ./match-request.ts — pure, and
// therefore pinned by match-request.test.ts rather than by the comment that used to
// stand here saying what they guarantee.

// ADDED /perfect 2026-09-03 (match-route-answers-like-its-siblings). Keyless/open is
// the standing premise of the rate-limit contract, so this route is reachable
// unauthenticated — and EVERY accepted call spawns match_cli AND writes the whole live
// job corpus to a temp file first. No model spend, but a process and an unbounded disk
// write per request, which is exactly the reason /api/extract-text (20) and the
// reasoning twin (60) are limited. 60/10min per IP sits far above a recruiter re-ranking
// a candidate against the corpus — the panel fires one request per run — while a
// scripted loop meets it in a second.
const MATCH_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };

export async function POST(request: NextRequest) {
  let workdir: string | null = null;
  try {
    const body = (await request.json()) as MatchInputBody & { limit?: number; weights?: unknown };
    const limit = resolveMatchLimit(body.limit);

    const workspaceId = await currentWorkspace();
    // The limiter sits AFTER the body parse (which costs nothing and is needed to
    // refuse a malformed request honestly) but BEFORE createWorkdir — the first
    // thing here that touches the disk — so a throttled call leaves no temp dir and
    // spawns no child.
    if (!rateLimit(`match:${clientIpFrom(request.headers)}`, MATCH_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    workdir = await createWorkdir();
    const input = await writeMatchInput(body, workdir, workspaceId);
    if ("error" in input) {
      // The candidate/profile/analysis the body named does not resolve in this
      // workspace (404) or the body named none at all (400). A refusal, not a fault:
      // the recruiter's move is to pick a different candidate, and the focus panel
      // resolves the code in the reader's language instead of painting English.
      return jsonRefusal("MATCH_INPUT_INVALID", input.status);
    }
    const args = ["-m", "pipeline.jobfit.match_cli", ...input.inputArgs, "--limit", String(limit)];
    // A recruiter-ingested/published job never reaches the static seed corpus the
    // CLI reads, so it was scored by the Fit Matrix yet absent from the Match tab
    // at any rank. Hand the live DB corpus over as --jobs-json overrides (DB wins
    // on id collision) — mirrors /api/matrix's --jobs-json and rematch's
    // live-corpus hand-off in automation-run.ts.
    const corpusJobs = listCorpusJobs(workspaceId);
    if (corpusJobs.length > 0) {
      const jobsPath = path.join(workdir, "jobs.json");
      await writeFile(jobsPath, JSON.stringify(corpusJobs), "utf-8");
      args.push("--jobs-json", jobsPath);
    }
    // Recruiter weight override (MAT1): forwarded as a JSON arg only when it's a
    // plain object of finite numbers. The Python scorer clamps it to the
    // archetype's bounds + renormalizes, so the client can't push an out-of-range
    // or non-summing vector; anything malformed falls back to the baseline there too.
    const weights = sanitizeMatchWeights(body.weights);
    if (weights) args.push("--weights", JSON.stringify(weights));

    // Forward the request's abort signal so an abandoned request SIGKILLs the child
    // (and reaches the finally → cleanupWorkdir) instead of orphaning it to the 600s
    // backstop and leaking the temp dir — the leak extract-text already guards against.
    const { result } = spawnPython(args, { signal: request.signal });
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      // The runner's machine CODE, never its message: match_cli's stderr carries the
      // temp workdir path and a Python traceback, and this route forwarded both to the
      // browser verbatim. Same mapper the grid and the reasoning popover already use.
      const answer = matrixEngineAnswer(err, MATCH_RUN_SURFACE);
      return answer.kind === "refusal"
        ? jsonRefusal(answer.code, err.status)
        : safeJsonError(new Error(err.message), "api:match", answer.code, err.status);
    }
    // parsePythonJson, not raw JSON.parse (idea-37493de3): the CLIs can print
    // stray non-JSON to stdout AFTER the result line (asyncio shutdown chatter,
    // ResourceWarnings) — a successful match must not be reported as a 500
    // because the interpreter logged a teardown notice.
    return NextResponse.json(parsePythonJson<Record<string, unknown>>(stdout, stderr));
  } catch (error) {
    // The JSON body parse, better-sqlite3, fs and the spawn itself all throw with
    // internal detail in `.message` (the db path, the temp workdir) — logged, never
    // forwarded.
    return safeJsonError(error, "api:match", "MATCH_RUN_FAILED");
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
