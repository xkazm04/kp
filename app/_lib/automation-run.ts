import { writeFile } from "node:fs/promises";
import path from "node:path";
import { lookupPromptCache, storePromptCache } from "./db/analyses";
import { listCorpusJobs } from "./db/jobs";
import { actOnPipelineEntry, createPipelineEntry, getPipelineEntry, hasEvent, recordAutomationEvent, rematchSourceEntry, setApproval } from "./db/pipeline";
import { getProfileRecord } from "./db/profiles";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { meterAllows } from "./billing";
import { buildLlmConfigEnv } from "./llm-config";
import {
  computeAutomationCacheKey,
  computeCorpusFingerprint,
  GITHUB_EVIDENCE_TASKS,
  LETTER_LANG_TASKS,
  UI_LANG_TASKS,
} from "./automation-cache-key";
import { screenStageOutcome } from "./pipeline-stages";
import { getInterviewPlan } from "./interview-plan";
import { extendDraftedOffer } from "./pipeline-entry-action";
import { sealDecisionSafe } from "./decision-record-store";
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
  // v2 — screen receives --lang (its rationale/strengths/redFlags are recruiter-
  // facing prose) but its cache key ignored the locale, so a locale switch served
  // the previous language's screening rationale for the full 168h TTL. The locale
  // is now a key axis (UI_LANG_TASKS); bumped so the wrongly-shared v1 entries
  // self-invalidate. Kept in lockstep with automation.SCREENING_PROMPT_VERSION.
  screen: "screening-v2",
  // v2 — the candidate-facing letter tasks take an explicit --lang (the entry's
  // resolved comms locale) and their prompts carry the gender-neutral-Czech +
  // no-invented-terms directives; bumped so cached v1 letters self-invalidate.
  outreach: "outreach-v2",
  rejection: "rejection-v2",
  prep: "interview-prep-v1",
  // v5 — the read-back exchange is emitted as STRUCTURED `entities` (confirmed /
  // corrected heard→meant / unconfirmed) beside the prose trust rule, so the recruiter
  // gets a cue that "Rust" in the transcript meant React; bumped so cached v4
  // scorecards self-invalidate and re-run with the structured field.
  // v6 — same locale-axis fix as screen: the scorecard summary is recruiter-facing
  // prose generated in the requested --lang, so the locale now splits its key;
  // bumped so the wrongly-shared v5 entries self-invalidate.
  scorecard: "scorecard-v6",
  rematch: "rematch-v1",
  // v3 — the offer payload carries its structured pricing basis (matchBasis, the
  // draft-time fresh fit check) and a rationale that names that producer
  // (REC-01/OO-L2-10); bumped so cached v2 payloads self-invalidate.
  offer: "offer-v3",
};
// LETTER_LANG_TASKS — candidate-facing letters; their language is the entry's
// resolved comms locale (explicit apply choice, else the workspace default —
// comms-locale.resolveCommsLocale), passed to Python as --lang so the letter and
// its deterministic chrome (subject fallback, offer terms/response footers, GDPR
// footer) can never disagree (OO-L1-03's two-authorities defect).
// UI_LANG_TASKS — recruiter-facing NARRATIVE (screening rationale, interview prep,
// scorecard summary — all surfaced in Decisions); their language is the recruiter's
// UI locale (getServerLocale = the org's app language), passed as --lang.
// BOTH are imported from automation-cache-key, where their union (LANG_KEYED_TASKS)
// is the key's locale axis — so "receives --lang" and "keys on lang" are ONE set.
const LETTER_TASKS = LETTER_LANG_TASKS;
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

export async function runAutomationTask(
  entryId: string,
  task: string,
  notes = "",
  signal?: AbortSignal,
  lang?: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
): Promise<AutomationResult> {
  if (!(task in AUTOMATION_VERSION)) throw new AutomationError(`unknown task: ${task}`, 404);
  // Tenant (P1): the entry read + every downstream mutation scope to the entry's own team
  // (passed by the batch sweep as entry.workspaceId, or by the route as currentWorkspace()).
  // The recordAutomationEvent calls' EVENTS auto-derive their tenant from the entry, so they
  // stay correct regardless; threading workspaceId keeps their label/title enrichment right.
  const entry = getPipelineEntry(entryId, workspaceId);
  if (!entry) throw new AutomationError("entry not found", 404);
  if (!entry.candidateId) throw new AutomationError("entry has no candidate profile", 400);
  const rec = getProfileRecord(entry.candidateId, workspaceId);
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
  // Billing degrade, resolved BEFORE the key (not at spawn time): past the
  // ai_candidates allowance the run spends the deterministic templates
  // (`--no-llm`) instead of the model, and the two outputs must never share a
  // cache entry — otherwise a quota-exhausted workspace's stubs keep serving for
  // the full 168h TTL after the allowance resets (and vice versa). Same boolean
  // feeds the key axis and the CLI flag, so they can't disagree.
  // Tenancy: the degrade switch reads THIS entry's workspace billing state (the
  // route passes currentWorkspace(), the batch sweep the entry's own team) — not
  // the default workspace's, which used to decide it for every tenant alike.
  const degraded = !meterAllows("ai_candidates", { workspace: workspaceId });
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
    degraded,
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
      // `degraded` is the SAME boolean folded into the cache key above.
      if (degraded) args.push("--no-llm");
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
      const moved = actOnPipelineEntry(entry.id, "accept", undefined, { expectedStage: entry.stage, actor: "system" }, workspaceId);
      if (!moved) {
        // Stage changed mid-hop — skip the move AND the dependent approval/event so
        // the screening_review can't land on a now-unexpected (or terminal) stage.
        return { result, source: payload.source, applied: "skipped_stage_changed" };
      }
    }
    if (holdForReview) {
      setApproval(entry.id, "screening_review", JSON.stringify(result), workspaceId);
      recordAutomationEvent(entry.id, "screening_hold", readRecommendation(result, task), workspaceId);
      // interviewPlan screeningGate="auto" — the workspace chose to trust the
      // AI's ADVANCE verdicts: a review parked only for confidence (recommendation
      // advance, route hold) is ratified unattended through the SAME accept
      // machinery a recruiter's click uses (advance + calendar gate + auto_advanced
      // event), CAS-guarded on the approval just set. hold/reject recommendations
      // ALWAYS park — auto mode never overrides a cautious or adverse verdict.
      if (
        getInterviewPlan(workspaceId).screeningGate === "auto" &&
        coerceInterviewRecommendation(String((result as { recommendation?: unknown }).recommendation ?? "")) === "advance"
      ) {
        const ratified = actOnPipelineEntry(
          entry.id,
          "accept",
          undefined,
          { expectedApprovalKind: "screening_review", actor: "system" },
          workspaceId
        );
        if (ratified) {
          sealDecisionSafe({
            kind: "auto_advanced",
            actor: "auto:interview-plan",
            policyVersion: "interview-plan",
            candidateRef: entry.id,
            rationale: "Screening advance verdict auto-ratified per the hiring plan (screening gate: auto).",
            reasonCode: "accept",
            inputs: { fromStage: entry.stage, approvalKind: "screening_review" },
          });
          applied = "auto_ratified";
        }
      }
    }
    if (applied !== "auto_ratified") applied = screenApplied;
  } else if (task === "scorecard") {
    setApproval(entry.id, "scorecard_review", JSON.stringify(result), workspaceId);
    recordAutomationEvent(entry.id, "interview_scorecard", readRecommendation(result, task), workspaceId);
    applied = "scorecard_ready";
  } else if (task === "offer") {
    setApproval(entry.id, "offer_review", JSON.stringify(result), workspaceId);
    recordAutomationEvent(entry.id, "offer_drafted", String(result.recommended ?? ""), workspaceId);
    applied = "offer_ready";
    // interviewPlan offerGate="auto" — extend the freshly-drafted offer to the
    // candidate unattended, through the SAME extend path a recruiter's approval
    // uses (idempotent open-offer reuse, truthful sent/queued dispatch, sealed
    // offer_terms with the machine as actor). Two hard guards:
    //   • an UNPRICED fail-safe draft (recommended null — no figure was willing
    //     to be invented) ALWAYS parks for a human to price it;
    //   • the extend runs on the FRESH row (the approval just written), so a
    //     concurrent decision can't be clobbered.
    // Origin "" → publicBaseUrl resolves the configured/canonical public origin
    // (never a request Host), which is exactly right for a background extend.
    if (getInterviewPlan(workspaceId).offerGate === "auto" && result.recommended != null) {
      const fresh = getPipelineEntry(entry.id, workspaceId);
      if (fresh && fresh.approvalKind === "offer_review") {
        try {
          await extendDraftedOffer(fresh, workspaceId, "", null, "auto:interview-plan");
          recordAutomationEvent(entry.id, "offer_auto_extended", "Offer extended unattended per the hiring plan (offer gate: auto).", workspaceId);
          applied = "offer_sent";
        } catch (error) {
          // The draft is parked at offer_review as if the gate were human — an
          // auto-extend failure must never lose the draft.
          console.error("[automation:offer] auto-extend failed; draft parked for human approval", error);
        }
      }
    }
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
        // …and the target lands in the SAME team as the source (one candidate, one team).
        workspaceId,
      });
      if (created) {
        // Define what rematch does to the SOURCE entry (idea-9ad8a777): close it so
        // the candidate isn't live + automatable in two funnels at once, and stamp
        // the bidirectional link so the funnel never double-counts one person. The
        // close re-reads the source under a write lock — if a recruiter/pass already
        // moved or closed it during the LLM hop, that branch is handled atomically
        // (already-terminal links only; Hired is left untouched). The source-side
        // `rematched` event is recorded inside rematchSourceEntry.
        rematchSourceEntry(entry.id, target.id, result.jobId as string, workspaceId);
        recordAutomationEvent(target.id, "rematched_from", `${entry.id} (${entry.jobId ?? "?"})`, workspaceId);
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
    if (hasEvent(entry.id, "outreach_sent", workspaceId) || outreachInFlight.has(entry.id)) {
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
    recordAutomationEvent(entry.id, DRAFT_EVENT[task] ?? task, "", workspaceId);
    applied = "drafted";
  }

  return { result, source: payload.source, applied };
}
