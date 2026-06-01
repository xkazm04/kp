import { NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { candidateOutcomes, getJob, type CandidateOutcome } from "@/app/_lib/db";
import { buildCandidatePool } from "@/app/_lib/candidate-pool";
import { cleanupWorkdir, createWorkdir, parseStderrError, spawnPython } from "@/app/_lib/python-runner";

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

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let workdir: string | null = null;
  try {
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    const pool = buildCandidatePool();
    if (pool.length === 0) {
      return NextResponse.json({ job: { id: job.id, title: job.title }, rediscovered: [] });
    }

    workdir = await createWorkdir();
    const inputPath = path.join(workdir, "recruiter.json");
    await writeFile(inputPath, JSON.stringify({ jobId: id, candidates: pool }), "utf-8");
    const jobPath = path.join(workdir, "job.json");
    await writeFile(jobPath, JSON.stringify(job), "utf-8");

    const { result } = spawnPython([
      "-m",
      "pipeline.jobfit.recruiter_cli",
      "--input-json",
      inputPath,
      "--job-json",
      jobPath,
    ]);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    const ranked = JSON.parse(stdout) as {
      candidates: {
        candidateId: string;
        label: string;
        archetype?: string;
        koPassed: boolean;
        result?: { total?: number };
      }[];
    };
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
