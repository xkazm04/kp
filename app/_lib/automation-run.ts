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
  rematchSourceEntry,
  setApproval,
  storePromptCache,
} from "./db";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { meterAllows } from "./billing";
import { buildLlmConfigEnv } from "./llm-config";
import { computeAutomationCacheKey, computeCorpusFingerprint, GITHUB_EVIDENCE_TASKS } from "./automation-cache-key";
import { screenStageOutcome } from "./pipeline-stages";
import { resolveCommsLocale } from "./comms-locale";
import { getWorkspaceDefaultLocale } from "./db/workspaces";
import { isLocale, type Locale } from "@/i18n/locales";
import { dispatchOutreach } from "./comms-dispatch";
import {
  coerceInterviewRecommendation,
  coerceScreenRoute,
  isInterviewRecommendation,
  INTERVIEW_RECOMMENDATION_FALLBACK,
} from "./interview-recommendation";

// Shared core for the on-demand LLM HR tasks. Used directly by /api/automation/[task]
// AND by the background-task runner (single + batch). The LLM engine is the
// configured provider per KP_LLM_CONFIG (Claude CLI when unconfigured).
export const AUTOMATION_VERSION: Record<string, string> = {
  screen: "screening-v1",
  // v2 — the candidate-facing letter tasks take an explicit --lang (the entry's
  // resolved comms locale) and their prompts carry the gender-neutral-Czech +
  // no-invented-terms directives; bumped so cached v1 letters self-invalidate.
  outreach: "outreach-v2",
  rejection: "rejection-v2",
  prep: "interview-prep-v1",
  scorecard: "scorecard-v3",
  rematch: "rematch-v1",
  // v3 — the offer payload carries its structured pricing basis (matchBasis, the
  // draft-time fresh fit check) and a rationale that names that producer
  // (REC-01/OO-L2-10); bumped so cached v2 payloads self-invalidate.
  offer: "offer-v3",
};
// The tasks whose output is a candidate-facing LETTER: their language is the
// entry's resolved comms locale (explicit apply choice, else the workspace
// default — comms-locale.resolveCommsLocale), passed to Python as --lang so the
// letter and its deterministic chrome (subject fallback, offer terms/response
// footers, GDPR footer) can never disagree (OO-L1-03's two-authorities defect).
const LETTER_TASKS = new Set(["outreach", "rejection", "offer"]);
// The tasks whose output is recruiter-facing NARRATIVE (screening rationale,
// interview prep, scorecard summary — all surfaced in Decisions): their language
// is the recruiter's UI locale (getServerLocale = the org's app language), passed
// as --lang. It is also a cache axis so a locale change can't serve a cached
// wrong-language narrative for the 168h TTL.
const UI_LANG_TASKS = new Set(["prep", "screen", "scorecard"]);
// Event kind for the generic "drafted" tasks — ONLY those that fall through to the
// catch-all branch below (currently rejection + prep). screen/scorecard/offer/
// rematch/outreach each have their own branch and record their own event, so they
// must NOT be listed here (an outreach entry was dead: outreach records
// "outreach_sent" via dispatchOutreach, never "outreach_drafted").
const DRAFT_EVENT: Record<string, string> = {
  rejection: "rejection_drafted",
  prep: "interview_prep_generated",
};
const TTL_HOURS = 168;

// Per-entry in-process single-flight for outreach (mirrors automation-pass's inFlightPass).
// The durable `outreach_sent` marker is written only AFTER sendComm, so two concurrent
// same-process /api/automation/outreach calls for one entry both passed the hasEvent gate
// and double-sent. The manual surfaces run in the same Next server process as the heartbeat,
// so an in-process guard suffices; on send failure the entry is released so a retry works.
const outreachInFlight = new Set<string>();

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

export async function runAutomationTask(entryId: string, task: string, notes = "", signal?: AbortSignal, lang?: string): Promise<AutomationResult> {
  if (!(task in AUTOMATION_VERSION)) throw new AutomationError(`unknown task: ${task}`, 404);
  const entry = getPipelineEntry(entryId);
  if (!entry) throw new AutomationError("entry not found", 404);
  if (!entry.candidateId) throw new AutomationError("entry has no candidate profile", 400);
  const rec = getProfileRecord(entry.candidateId);
  if (!rec) throw new AutomationError("candidate profile not found", 400);

  // Rematch REDIRECTS a candidate to a better-fit role and closes out their current
  // entry (idea-9ad8a777). A Hired candidate is placed — never redirect them, and
  // short-circuit BEFORE the LLM/corpus hop so a placed person is neither charged a
  // model call nor forked into a second active funnel. (The "Explore alternatives"
  // action is UI-gated to pre-Hired stages; this also guards the direct API /
  // background-task path. "Hired" is the terminal PIPELINE_STAGES member.)
  if (task === "rematch" && entry.stage === "Hired") {
    return { result: { found: false, reason: "candidate is hired; rematch skipped" }, source: "skipped", applied: "skipped_hired" };
  }

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
  // GH7 — serialize the entry's compact GitHub evidence ONCE for the tasks whose
  // prompts consume it (GITHUB_EVIDENCE_TASKS = screen/prep/scorecard): the same
  // bytes are written to github.json for Python below AND folded into the cache
  // key, so a refreshed deep-dive — or evidence appearing on a previously bare
  // entry — invalidates the 168h cache instead of a stale HIT serving a verdict
  // the AI formed without it. Mirrors the profileJson serialize-once pattern.
  const githubEvidenceJson =
    GITHUB_EVIDENCE_TASKS.has(task) && entry.githubEvidence ? JSON.stringify(entry.githubEvidence) : null;
  // Letter tasks render in the entry's resolved comms locale (pa-l2-null-locale):
  // resolved HERE — not left to the CV-language guess inside Python — so the
  // letter provably matches the locale comms-dispatch wraps it in.
  const letterLang = LETTER_TASKS.has(task) ? resolveCommsLocale(entry.locale) : undefined;
  // Recruiter-narrative tasks (prep/screen/scorecard) render in the caller's UI
  // locale when it passed one (getServerLocale, request scope), else the org's
  // configured language (the workspace default) — so a background pass localizes
  // too, never a silent English default. Mirrors resolveCommsLocale's fallback.
  const uiLang: Locale | undefined = UI_LANG_TASKS.has(task)
    ? isLocale(lang)
      ? lang
      : getWorkspaceDefaultLocale()
    : undefined;
  const cacheKey = computeAutomationCacheKey({
    version,
    task,
    candidateId: entry.candidateId,
    profileJson,
    jobId: entry.jobId ?? null,
    stage: entry.stage,
    notes,
    corpusFingerprint: corpusJobs ? computeCorpusFingerprint(corpusJobs.map((j) => j.id)) : undefined,
    // PREP2 — the recruiter-narrative locale (prep/screen/scorecard, uiLang) is a
    // cache axis; for the letter tasks the RESOLVED letter locale is one too (a
    // locale fix must not serve a cached wrong-language output for up to 7 days).
    // Tasks in neither set (rematch) ignore it.
    lang: uiLang ?? letterLang,
    githubEvidenceJson: githubEvidenceJson ?? undefined,
  });

  let payload = lookupPromptCache(cacheKey, version) as CliPayload | null;
  let workdir: string | null = null;
  try {
    if (!payload) {
      workdir = await createWorkdir();
      const profilePath = path.join(workdir, "profile.json");
      await writeFile(profilePath, profileJson, "utf-8");

      const args = ["-m", "pipeline.jobfit.automation_cli", task, "--profile-json", profilePath];
      // Billing degrade: past the AI-candidates allowance, automation drafting
      // runs the deterministic templates (--no-llm) instead of blocking the
      // pipeline. Part of the analyze-debited candidate bundle — no extra debit.
      if (!meterAllows("ai_candidates")) args.push("--no-llm");
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
      // PREP2 — the recruiter-narrative tasks (prep/screen/scorecard) render in the
      // resolved uiLang (the org's app language); the LETTER tasks
      // (outreach/rejection/offer) render in the CANDIDATE'S resolved comms locale,
      // so the Python-drafted letter and the TS-rendered chrome around it are one
      // language authority. The two sets are disjoint — at most one --lang is pushed.
      if (uiLang) args.push("--lang", uiLang);
      if (letterLang) args.push("--lang", letterLang);
      // GH7 — hand the persisted GitHub evidence to the screen/prep/scorecard
      // prompts (mirrors the --notes-file pattern). Python renders it as a
      // compact "Public repo evidence" block; null (bare entry or a task that
      // never reads it) keeps the prompt byte-identical to pre-GH7.
      if (githubEvidenceJson) {
        const githubPath = path.join(workdir, "github.json");
        await writeFile(githubPath, githubEvidenceJson, "utf-8");
        args.push("--github-evidence", githubPath);
      }

      const { result } = spawnPython(args, { signal, env: buildLlmConfigEnv() });
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
    // CAS on the snapshot stage: `entry` was read before the seconds-long Python/LLM
    // hop, so a recruiter (Decisions) or a concurrent pass may have advanced/rejected
    // it meanwhile. A stale screen verdict must no-op instead of moving whatever stage
    // the entry is in NOW — mirrors the policy-pass hardening (automation-pass.ts).
    if (advance) {
      const moved = actOnPipelineEntry(entry.id, "accept", undefined, { expectedStage: entry.stage, actor: "system" });
      if (!moved) {
        // Stage changed mid-hop — skip the move AND the dependent approval/event so
        // the screening_review can't land on a now-unexpected (or terminal) stage.
        return { result, source: payload.source, applied: "skipped_stage_changed" };
      }
    }
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
      // createPipelineEntry is idempotent (a corpus edit self-invalidates the
      // rematch cache, so re-runs are frequent). The source→target resolution below
      // runs ONLY when a NEW target was actually created — so the source is closed
      // and the link stamped exactly once per real redirect, never re-fired on a
      // re-run for the same placement.
      const { entry: target, created } = createPipelineEntry({
        candidateId: entry.candidateId,
        candidateLabel: entry.candidateLabel,
        archetype: entry.archetype,
        roleFamily: (result.roleFamily as string) ?? null,
        jobId: result.jobId as string,
        jobTitle: (result.jobTitle as string) ?? (result.jobId as string),
        matchScore: (result.score as number) ?? null,
        stage: "Screened",
        // The redirected person is the SAME candidate — their language choice
        // (captured at apply) must follow them onto the target entry, or the
        // rematch would silently flip their comms back to the workspace default.
        locale: entry.locale,
      });
      if (created) {
        // Define what rematch does to the SOURCE entry (idea-9ad8a777): close it so
        // the candidate isn't live + automatable in two funnels at once, and stamp
        // the bidirectional link so the funnel never double-counts one person. The
        // close re-reads the source under a write lock — if a recruiter/pass already
        // moved or closed it during the LLM hop, that branch is handled atomically
        // (already-terminal links only; Hired is left untouched). The source-side
        // `rematched` event is recorded inside rematchSourceEntry.
        rematchSourceEntry(entry.id, target.id, result.jobId as string);
        recordAutomationEvent(target.id, "rematched_from", `${entry.id} (${entry.jobId ?? "?"})`);
        applied = "rematched";
      } else {
        applied = "already_rematched";
      }
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
    if (hasEvent(entry.id, "outreach_sent") || outreachInFlight.has(entry.id)) {
      applied = "already_sent";
    } else {
      outreachInFlight.add(entry.id);
      try {
        const outcome = await dispatchOutreach(entry, result);
        // A consent-suppressed outreach records no outreach_sent marker, so the UI
        // surfaces "cannot contact — consent expired/anonymized" and a re-consent can
        // still be reached later.
        applied = outcome.sent
          ? "sent"
          : outcome.reason === "anonymized"
            ? "suppressed_anonymized"
            : "suppressed_consent_expired";
      } finally {
        // Release on completion AND on failure: dispatchOutreach records the durable marker
        // only on a successful send, so clearing the in-flight slot lets a failed send retry.
        outreachInFlight.delete(entry.id);
      }
    }
  } else {
    recordAutomationEvent(entry.id, DRAFT_EVENT[task] ?? task, "");
    applied = "drafted";
  }

  return { result, source: payload.source, applied };
}
