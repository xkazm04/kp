import { NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { candidateOutcomes, getJob, type CandidateOutcome } from "@/app/_lib/db";
import { buildCandidatePool } from "@/app/_lib/candidate-pool";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "@/app/_lib/python-runner";

export const runtime = "nodejs";

// Talent rediscovery: rank the whole candidate pool against THIS job, then
// surface "silver medalists" — people rejected/closed elsewhere (or parked in a
// different role) who clear the bar for this one and aren't already in it.

// Minimum match total (0-100) a rediscovered candidate must clear. 55 mirrors
// matching.FIT_PROMISING_THRESHOLD — at/above "promising" fit — so rediscovery
// surfaces genuinely viable silver-medalists, not long-shots.
const SCORE_FLOOR = 55;
// Max rediscovered candidates returned (ranked by score, so top-N). `more` in
// the response reports how many eligible were dropped, so the cap never reads as
// "this is everyone".
const REDISCOVER_LIMIT = 20;

type PriorOutcome = { kind: "rejected" | "closed" | "elsewhere"; label: string };

function pickPrior(hist: CandidateOutcome[], jobId: string): PriorOutcome | null {
  const role = (o: CandidateOutcome) => o.jobTitle ?? "another role";
  const rejected = hist.find((h) => h.status === "rejected");
  if (rejected) return { kind: "rejected", label: `Rejected · ${role(rejected)}` };
  const closed = hist.find((h) => h.status === "closed" || h.status === "declined");
  if (closed) return { kind: "closed", label: `Closed · ${role(closed)}` };
  const elsewhere = hist.find((h) => h.jobId !== jobId && (h.status === "active" || h.stage === "Hired"));
  if (elsewhere) return { kind: "elsewhere", label: `${elsewhere.stage} · ${role(elsewhere)}` };
  return null;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let workdir: string | null = null;
  try {
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    const pool = buildCandidatePool();
    if (pool.length === 0) {
      return NextResponse.json({ job: { id: job.id, title: job.title }, rediscovered: [], skipped: [] });
    }

    workdir = await createWorkdir();
    const inputPath = path.join(workdir, "recruiter.json");
    await writeFile(inputPath, JSON.stringify({ jobId: id, candidates: pool }), "utf-8");
    const jobPath = path.join(workdir, "job.json");
    await writeFile(jobPath, JSON.stringify(job), "utf-8");

    // Thread the request's AbortSignal so abandoning rediscovery (clicking to the
    // next role, closing the panel) promptly SIGKILLs the recruiter_cli child
    // instead of leaking an orphaned ranking process to the 600s backstop.
    const { result } = spawnPython(
      [
        "-m",
        "pipeline.jobfit.recruiter_cli",
        "--input-json",
        inputPath,
        "--job-json",
        jobPath,
      ],
      { signal: request.signal },
    );
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    // parsePythonJson, not raw JSON.parse: the interpreter routinely prints
    // trailing non-JSON at shutdown (asyncio "Event loop is closed", leaked-
    // semaphore / ResourceWarning, atexit — common on Windows), and one such line
    // would turn a successful ranking into a JSON.parse throw / 500.
    const ranked = parsePythonJson<{
      candidates: {
        candidateId: string;
        label: string;
        archetype?: string;
        koPassed: boolean;
        result?: { total?: number };
      }[];
      // recruiter_cli skips (never drops) any candidate whose profile fails to
      // validate — a malformed silver-medalist must still be surfaced, not lost.
      skipped?: { id: string; label: string; reason: string }[];
    }>(stdout, stderr);
    const outcomes = candidateOutcomes();

    const rediscovered = ranked.candidates
      .filter((row) => row.koPassed && Math.round(row.result?.total ?? 0) >= SCORE_FLOOR)
      .map((row) => {
        const hist = outcomes.get(row.candidateId) ?? [];
        const activeHere = hist.some((h) => h.jobId === id && h.status === "active");
        if (activeHere) return null;
        const prior = pickPrior(hist, id);
        if (!prior) return null;
        return {
          candidateId: row.candidateId,
          label: row.label,
          archetype: row.archetype ?? "bau",
          score: Math.round(row.result?.total ?? 0),
          prior,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.score - a.score);

    const shown = rediscovered.slice(0, REDISCOVER_LIMIT);
    return NextResponse.json({
      job: { id: job.id, title: job.title },
      rediscovered: shown,
      // Candidates the ranker couldn't score (malformed profile). The candidates
      // view already surfaces these; rediscovery — whose whole promise is "we won't
      // let strong past candidates fall through the cracks" — must not silently
      // drop them, so thread the array through to the same disclosure.
      skipped: ranked.skipped ?? [],
      // How many eligible silver-medalists were dropped by the cap (0 when all shown).
      more: Math.max(0, rediscovered.length - shown.length),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Rediscovery failed." },
      { status: 500 }
    );
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
