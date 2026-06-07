import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  actOnPipelineEntry,
  createPipelineEntry,
  getPipelineEntry,
  getProfileRecord,
  hasEvent,
  listCorpusJobs,
  lookupPromptCache,
  recordAutomationEvent,
  setApproval,
  storePromptCache,
} from "./db";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { computeAutomationCacheKey, computeCorpusFingerprint } from "./automation-cache-key";
import { screenStageOutcome } from "./pipeline-stages";
import { dispatchOutreach } from "./comms-dispatch";
import {
  coerceInterviewRecommendation,
  coerceScreenRoute,
  isInterviewRecommendation,
  INTERVIEW_RECOMMENDATION_FALLBACK,
} from "./interview-recommendation";

// Shared core for the on-demand LLM HR tasks. Used directly by /api/automation/[task]
// AND by the background-task runner (single + batch). Claude CLI only.
export const AUTOMATION_VERSION: Record<string, string> = {
  screen: "screening-v1",
  outreach: "outreach-v1",
  rejection: "rejection-v1",
  prep: "interview-prep-v1",
  scorecard: "scorecard-v3",
  rematch: "rematch-v1",
  offer: "offer-v1",
};
const DRAFT_EVENT: Record<string, string> = {
  outreach: "outreach_drafted",
  rejection: "rejection_drafted",
  prep: "interview_prep_generated",
};
const TTL_HOURS = 168;

export class AutomationError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type AutomationResult = { result: Record<string, unknown>; source: string; applied: string };
type CliPayload = { result: Record<string, unknown>; source: string };

// Read the model's recommendation at the TS parse boundary, validated against the
// canonical advance|hold|reject contract. A present-but-off-taxonomy value (model
// drift) is logged once and coerced to the safe `hold` fallback before it reaches
// the audit event — so drift is caught early instead of silently slipping a
// misspelled verdict into pipeline_events. An absent value is the normal "no
// verdict" case and is coerced quietly.
function readRecommendation(result: Record<string, unknown>, task: string): string {
  const raw = result.recommendation;
  if (typeof raw === "string" && raw.trim() && !isInterviewRecommendation(raw)) {
    console.warn(
      `[automation:${task}] off-taxonomy interview recommendation ${JSON.stringify(raw)} → ` +
        `falling back to "${INTERVIEW_RECOMMENDATION_FALLBACK}"`
    );
  }
  return coerceInterviewRecommendation(raw);
}

export async function runAutomationTask(entryId: string, task: string, notes = ""): Promise<AutomationResult> {
  if (!(task in AUTOMATION_VERSION)) throw new AutomationError(`unknown task: ${task}`, 404);
  const entry = getPipelineEntry(entryId);
  if (!entry) throw new AutomationError("entry not found", 404);
  if (!entry.candidateId) throw new AutomationError("entry has no candidate profile", 400);
  const rec = getProfileRecord(entry.candidateId);
  if (!rec) throw new AutomationError("candidate profile not found", 400);

  const version = AUTOMATION_VERSION[task];
  // Serialize the profile ONCE: the same bytes are both fed to Python (profile.json
  // below) and folded into the cache key, so the key provably tracks the model's
  // input. Without the profile in the key, a re-extracted/edited CV left the key
  // unchanged and served up-to-7-day-stale output on Regenerate (idea-8dcf7828).
  const profileJson = JSON.stringify(rec.payload);
  // rematch is the one task whose correct answer depends on data OUTSIDE the cache
  // key — it scores the ENTIRE live job corpus, not just (candidate, currentJob). So
  // load that corpus ONCE here: its sorted-id fingerprint binds the cache key to the
  // current openings (a stale HIT self-invalidates the moment a role is added/removed),
  // and the SAME records are handed to Python below so the key tracks exactly what was
  // scored. The static seed file Python would otherwise read never reflects ingested/
  // published openings, so without this rematch could never even see a newer better
  // fit (idea-e01935e9). Other tasks score a single job and skip the corpus entirely.
  const corpusJobs = task === "rematch" ? listCorpusJobs() : null;
  const cacheKey = computeAutomationCacheKey({
    version,
    task,
    candidateId: entry.candidateId,
    profileJson,
    jobId: entry.jobId ?? null,
    stage: entry.stage,
    notes,
    corpusFingerprint: corpusJobs ? computeCorpusFingerprint(corpusJobs.map((j) => j.id)) : undefined,
  });

  let payload = lookupPromptCache(cacheKey, version) as CliPayload | null;
  let workdir: string | null = null;
  try {
    if (!payload) {
      workdir = await createWorkdir();
      const profilePath = path.join(workdir, "profile.json");
      await writeFile(profilePath, profileJson, "utf-8");

      const args = ["-m", "pipeline.jobfit.automation_cli", task, "--profile-json", profilePath];
      if (task === "rematch") {
        args.push("--current-job-id", entry.jobId ?? "");
        // Score the SAME live corpus we fingerprinted into the cache key (not Python's
        // static seed file) so the recommendation reflects current openings and the
        // HIT/MISS boundary stays honest. corpusJobs is non-null on the rematch path.
        const jobsPath = path.join(workdir, "jobs.json");
        await writeFile(jobsPath, JSON.stringify(corpusJobs ?? []), "utf-8");
        args.push("--jobs", jobsPath);
      } else args.push("--job-id", entry.jobId ?? "");
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
      storePromptCache(cacheKey, payload, version, TTL_HOURS);
    }
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }

  const result = payload.result;
  let applied = "drafted";

  if (task === "screen") {
    // Validate the screen-route gate at the TS parse boundary (Python derives
    // route ∈ {advance, hold}; anything off-set holds, never silently advances),
    // then map (stage, route) → pipeline effect. The Accepted stage triages a
    // fresh applicant: a clean advance screens them cleanly into Screened, a hold
    // screens them into Screened flagged for review — so the screening_review
    // always lands on a Screened entry and the Decisions→Interview path is reused
    // unchanged. From Screened: advance → Interview, hold → stays for review.
    const { advance, holdForReview, applied: screenApplied } = screenStageOutcome(
      entry.stage,
      coerceScreenRoute(result.route)
    );
    if (advance) actOnPipelineEntry(entry.id, "accept"); // Accepted→Screened or Screened→Interview
    if (holdForReview) {
      setApproval(entry.id, "screening_review", JSON.stringify(result));
      recordAutomationEvent(entry.id, "screening_hold", readRecommendation(result, task));
    }
    applied = screenApplied;
  } else if (task === "scorecard") {
    setApproval(entry.id, "scorecard_review", JSON.stringify(result));
    recordAutomationEvent(entry.id, "interview_scorecard", readRecommendation(result, task));
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
        stage: "Screened",
      });
      recordAutomationEvent(entry.id, "rematched", `${entry.jobId ?? "?"} -> ${result.jobId}`);
      applied = "rematched";
    } else {
      applied = "no_alternative";
    }
  } else if (task === "outreach") {
    // Non-adverse and recruiter-initiated — deliver the generated draft through
    // the comms channel (queued to the outbox by default; relayed if configured).
    //
    // The prompt cache makes the DRAFT idempotent, but dispatchOutreach is a real
    // side effect: it queues an outbox row and, with a relay configured, POSTs the
    // message to the candidate. A cache HIT within the 7-day TTL (double-click,
    // refresh-retry, or the same entry re-screened then outreach'd again) would
    // otherwise re-fire the send every time. Gate the dispatch on the durable
    // per-entry "outreach_sent" marker that dispatchOutreach itself records, so an
    // outreach is delivered at most once per entry — first-contact, not a resend.
    if (hasEvent(entry.id, "outreach_sent")) {
      applied = "already_sent";
    } else {
      await dispatchOutreach(entry, result);
      applied = "sent";
    }
  } else {
    recordAutomationEvent(entry.id, DRAFT_EVENT[task] ?? task, "");
    applied = "drafted";
  }

  return { result, source: payload.source, applied };
}
