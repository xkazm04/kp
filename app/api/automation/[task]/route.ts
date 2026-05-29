import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  actOnPipelineEntry,
  createPipelineEntry,
  getPipelineEntry,
  getProfileRecord,
  lookupGeminiCache,
  recordAutomationEvent,
  setApproval,
  storeGeminiCache,
} from "@/app/_lib/db";
import {
  cleanupWorkdir,
  createWorkdir,
  parseStderrError,
  spawnPython,
} from "@/app/_lib/python-runner";

export const runtime = "nodejs";

// On-demand LLM HR tasks (Claude CLI only). Task 7 (policy pass) is /api/automation/run.
const VERSION: Record<string, string> = {
  screen: "screening-v1",
  outreach: "outreach-v1",
  rejection: "rejection-v1",
  prep: "interview-prep-v1",
  scorecard: "scorecard-v1",
  rematch: "rematch-v1",
  offer: "offer-v1",
};
const DRAFT_EVENT: Record<string, string> = {
  outreach: "outreach_drafted",
  rejection: "rejection_drafted",
  prep: "interview_prep_generated",
};
const TTL_HOURS = 168;

const shortHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

type CliPayload = { result: Record<string, unknown>; source: string };

export async function POST(request: NextRequest, context: { params: Promise<{ task: string }> }) {
  const { task } = await context.params;
  let workdir: string | null = null;
  try {
    if (!(task in VERSION)) {
      return NextResponse.json({ error: `unknown task: ${task}` }, { status: 404 });
    }
    const body = (await request.json().catch(() => ({}))) as { entryId?: string; notes?: string };
    if (!body.entryId) {
      return NextResponse.json({ error: "entryId required" }, { status: 400 });
    }
    const entry = getPipelineEntry(body.entryId);
    if (!entry) return NextResponse.json({ error: "entry not found" }, { status: 404 });
    if (!entry.candidateId) {
      return NextResponse.json({ error: "entry has no candidate profile" }, { status: 400 });
    }
    const rec = getProfileRecord(entry.candidateId);
    if (!rec) return NextResponse.json({ error: "candidate profile not found" }, { status: 400 });

    const version = VERSION[task];
    const notes = typeof body.notes === "string" ? body.notes : "";
    // Cache key varies by the inputs each task actually consumes.
    const cacheKey = shortHash(
      [version, entry.candidateId, entry.jobId ?? "", task === "rejection" ? entry.stage : "", task === "scorecard" ? shortHash(notes) : ""].join("|")
    );

    let payload = lookupGeminiCache(cacheKey, version) as CliPayload | null;
    if (!payload) {
      workdir = await createWorkdir();
      const profilePath = path.join(workdir, "profile.json");
      await writeFile(profilePath, JSON.stringify(rec.payload), "utf-8");

      const args = ["-m", "pipeline.jobfit.automation_cli", task, "--profile-json", profilePath];
      if (task === "rematch") args.push("--current-job-id", entry.jobId ?? "");
      else args.push("--job-id", entry.jobId ?? "");
      if (task === "rejection") args.push("--stage", entry.stage);
      if (task === "scorecard") {
        const notesPath = path.join(workdir, "notes.txt");
        await writeFile(notesPath, notes, "utf-8");
        args.push("--notes-file", notesPath);
      }

      const { result } = spawnPython(args);
      const { stdout, stderr, exitCode } = await result;
      if (exitCode !== 0) {
        const err = parseStderrError(stderr, exitCode);
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      payload = JSON.parse(stdout) as CliPayload;
      storeGeminiCache(cacheKey, payload, version, TTL_HOURS);
    }

    const result = payload.result;
    let applied: string | null = null;

    if (task === "screen") {
      // Screening only acts at the AI-matched gate; elsewhere it's just an advisory read.
      if (entry.stage === "AI-matched") {
        if (result.route === "advance") {
          actOnPipelineEntry(entry.id, "accept");
          applied = "advanced";
        } else {
          setApproval(entry.id, "screening_review", JSON.stringify(result));
          recordAutomationEvent(entry.id, "screening_hold", String(result.recommendation ?? ""));
          applied = "held_for_review";
        }
      } else {
        applied = "advisory";
      }
    } else if (task === "scorecard") {
      setApproval(entry.id, "scorecard_review", JSON.stringify(result));
      recordAutomationEvent(entry.id, "interview_scorecard", String(result.recommendation ?? ""));
      applied = "scorecard_ready";
    } else if (task === "offer") {
      setApproval(entry.id, "offer_review", JSON.stringify(result));
      recordAutomationEvent(entry.id, "offer_drafted", String(result.recommended ?? ""));
      applied = "offer_ready";
    } else if (task === "rematch") {
      if (result.found && result.jobId) {
        createPipelineEntry({
          candidateId: entry.candidateId,
          candidateLabel: entry.candidateLabel,
          archetype: entry.archetype,
          roleFamily: (result.roleFamily as string) ?? null,
          jobId: result.jobId as string,
          jobTitle: (result.jobTitle as string) ?? (result.jobId as string),
          matchScore: (result.score as number) ?? null,
          stage: "AI-matched",
        });
        recordAutomationEvent(entry.id, "rematched", `${entry.jobId ?? "?"} -> ${result.jobId}`);
        applied = "rematched";
      } else {
        applied = "no_alternative";
      }
    } else {
      recordAutomationEvent(entry.id, DRAFT_EVENT[task] ?? task, "");
      applied = "drafted";
    }

    return NextResponse.json({ result, source: payload.source, applied });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Automation task failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
