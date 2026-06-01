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
} from "./db";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { dispatchOutreach } from "./comms-dispatch";

// Shared core for the on-demand LLM HR tasks. Used directly by /api/automation/[task]
// AND by the background-task runner (single + batch). Claude CLI only.
export const AUTOMATION_VERSION: Record<string, string> = {
  screen: "screening-v1",
  outreach: "outreach-v1",
  rejection: "rejection-v1",
  prep: "interview-prep-v1",
  scorecard: "scorecard-v2",
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

export class AutomationError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type AutomationResult = { result: Record<string, unknown>; source: string; applied: string };
type CliPayload = { result: Record<string, unknown>; source: string };

export async function runAutomationTask(entryId: string, task: string, notes = ""): Promise<AutomationResult> {
  if (!(task in AUTOMATION_VERSION)) throw new AutomationError(`unknown task: ${task}`, 404);
  const entry = getPipelineEntry(entryId);
  if (!entry) throw new AutomationError("entry not found", 404);
  if (!entry.candidateId) throw new AutomationError("entry has no candidate profile", 400);
  const rec = getProfileRecord(entry.candidateId);
  if (!rec) throw new AutomationError("candidate profile not found", 400);

  const version = AUTOMATION_VERSION[task];
  const cacheKey = shortHash(
    [version, entry.candidateId, entry.jobId ?? "", task === "rejection" ? entry.stage : "", task === "scorecard" ? shortHash(notes) : ""].join("|")
  );

  let payload = lookupGeminiCache(cacheKey, version) as CliPayload | null;
  let workdir: string | null = null;
  try {
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
        throw new AutomationError(err.message, err.status);
      }
      payload = parsePythonJson<CliPayload>(stdout, stderr);
      storeGeminiCache(cacheKey, payload, version, TTL_HOURS);
    }
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }

  const result = payload.result;
  let applied = "drafted";

  if (task === "screen") {
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
  } else if (task === "outreach") {
    // Non-adverse and recruiter-initiated — deliver the generated draft through
    // the comms channel (queued to the outbox by default; relayed if configured).
    await dispatchOutreach(entry, result);
    applied = "sent";
  } else {
    recordAutomationEvent(entry.id, DRAFT_EVENT[task] ?? task, "");
    applied = "drafted";
  }

  return { result, source: payload.source, applied };
}
