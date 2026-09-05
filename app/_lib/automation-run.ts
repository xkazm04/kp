import { writeFile } from "node:fs/promises";
import path from "node:path";
import { lookupPromptCache, storePromptCache } from "./db/analyses";
import { listCorpusJobs } from "./db/jobs";
import { actOnPipelineEntry, createPipelineEntry, getPipelineEntry, hasEvent, recordAutomationEvent, rematchSourceEntry, setApproval } from "./db/pipeline";
import { getProfileRecord } from "./db/profiles";
import { latestInterviewByEntry } from "./db/interviews";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { meterAllows } from "./billing";
import { buildLlmConfigEnv } from "./llm-config";
import { listLlmConfig } from "./db/llm";
import {
  computeAutomationCacheKey,
  computeCorpusFingerprint,
  GITHUB_EVIDENCE_TASKS,
  LETTER_LANG_TASKS,
  UI_LANG_TASKS,
} from "./automation-cache-key";
import { screenStageOutcome } from "./pipeline-stages";
import { getPlanGateForRole } from "./interview-plan";
import { extendDraftedOffer } from "./pipeline-entry-action";
import { sealDecisionSafe } from "./decision-record-store";
import { resolveCommsLocale } from "./comms-locale";
import { getWorkspaceDefaultLocale } from "./db/workspaces";
import { isLocale, type Locale } from "@/i18n/locales";
import { getPipelineAxis } from "./pipeline-axis-server";
import { screenedLandingStage, stageHasRole } from "./pipeline-stages";
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
  // v3 (prep v2 / offer v4) — 2026-08-11 bench round: letters get the shared
  // evidence context + anchoring/grounding rules, rejection names the decisive
  // gap with evidence-checked feedback, prep anchors questions in concrete
  // highlights and covers stated aspirations; bumped so cached prior letters
  // self-invalidate. Lockstep with the Python *_PROMPT_VERSION constants.
  outreach: "outreach-v3",
  // rejection v4 (and offer v5 below) — the two letters that follow an INTERVIEW now
  // receive the entry's stored scorecard. They were drafted from CV + score + stage
  // alone while the prompt demanded "the ACTUAL decisive reason", so the model
  // reached for the CV: an Interview-stage candidate was told the decisive reason
  // was a gap that had been on her CV the day she was invited in, and a sibling
  // draft invented "the decision was close". Every cached v3 rejection / v4 offer was
  // drafted blind to the interview, so the bump is what retires them. Lockstep with
  // automation.REJECTION_PROMPT_VERSION / OFFER_PROMPT_VERSION.
  rejection: "rejection-v4",
  prep: "interview-prep-v2",
  // v5 — the read-back exchange is emitted as STRUCTURED `entities` (confirmed /
  // corrected heard→meant / unconfirmed) beside the prose trust rule, so the recruiter
  // gets a cue that "Rust" in the transcript meant React; bumped so cached v4
  // scorecards self-invalidate and re-run with the structured field.
  // v6 — same locale-axis fix as screen: the scorecard summary is recruiter-facing
  // prose generated in the requested --lang, so the locale now splits its key;
  // bumped so the wrongly-shared v5 entries self-invalidate.
  // v7 — the transcript now enters the prompt through the untrusted-data fence
  // (candidate speech was the one unfenced block in the package) and the scoring
  // instructions carry the interviewer brief's no-penalty-for-nerves clause; both
  // change the prompt bytes, so cached v6 scorecards must self-invalidate.
  scorecard: "scorecard-v7",
  rematch: "rematch-v1",
  // v3 — the offer payload carries its structured pricing basis (matchBasis, the
  // draft-time fresh fit check) and a rationale that names that producer
  // (REC-01/OO-L2-10); bumped so cached v2 payloads self-invalidate.
  // v5 — see the rejection note above: the offer letter now sees the interview it
  // follows from, and its tone is branched on whether that interview closed as a yes.
  offer: "offer-v5",
};

/** The tasks whose prompt reads the entry's stored interview scorecard: the two
 *  candidate-facing letters drafted AFTER an interview. Everything else ignores it,
 *  and its prompt bytes are unchanged. */
export const SCORECARD_TASKS = new Set(["rejection", "offer"]);

/** Why an `offerGate="auto"` draft must NOT be extended unattended, or null when
 *  nothing here objects.
 *
 *  An offer letter auto-sent to a candidate is the highest-consequence output in
 *  the product, and the gate had exactly one evidential precondition: that a figure
 *  existed. Live, that was not enough — a draft went out on an entry whose OWN
 *  interview scorecard said `hold`, 2 of 5 on the technical axis. The gate's
 *  meaning is unchanged for every case the operator configured it for: an interview
 *  that closed as `advance`, and an entry with no interview at all (a recruiter can
 *  reach Offer without one), still auto-extend. Only the case where the workspace's
 *  own recorded verdict CONTRADICTS the send is refused — and refused by parking the
 *  draft at offer_review, never by rewriting the letter.
 *
 *  Takes the raw stored scorecard (unvalidated row JSON): an unreadable or verdict-
 *  less scorecard is "no recorded objection", not a refusal — it is the same absence
 *  as no interview. */
export function offerAutoExtendRefusal(scorecard: unknown): string | null {
  if (!scorecard || typeof scorecard !== "object") return null;
  const raw = (scorecard as { recommendation?: unknown }).recommendation;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const verdict = coerceInterviewRecommendation(raw);
  return verdict === "advance" ? null : `scorecard_${verdict}`;
}
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

// The refusals THIS module decides, as machine tokens. A route answers each with
// its own `jsonRefusal` code, in the reader's language; everything else that
// reaches the catch is a spawned-engine failure whose message carries internal
// detail (Python tracebacks, the workdir path, provider stderr) and must be
// answered with a STORE code instead. Without this split the two were
// indistinguishable at the boundary — both arrived as `AutomationError` and both
// had their raw `.message` forwarded.
export const AUTOMATION_REFUSALS = ["unknown_task", "entry_not_found", "entry_has_no_profile"] as const;
export type AutomationRefusal = (typeof AUTOMATION_REFUSALS)[number];

export class AutomationError extends Error {
  status: number;
  /** Present ONLY on this module's own refusals (see AUTOMATION_REFUSALS). An
   *  engine failure carries none — that is how a route tells "you asked for
   *  something that isn't there" from "the pipeline broke". */
  refusal?: AutomationRefusal;
  constructor(message: string, status: number, refusal?: AutomationRefusal) {
    super(message);
    this.status = status;
    this.refusal = refusal;
  }
}

export type AutomationResult = { result: Record<string, unknown>; source: string; applied: string };
type CliPayload = { result: Record<string, unknown>; source: string };

// ---- Verdict provenance (llm vs template) -----------------------------------
//
// The CLI already tells us which engine actually answered: `source` is "llm" only
// when the model's payload survived coercion, and "deterministic" for every
// degrade — keyless install, unmetered workspace (`--no-llm`), a failed call, or a
// payload coercion discarded (pipeline/jobfit/automation.py `_generate`). The
// cache key splits on it too (`degraded` axis, automation-cache-key.ts), so the
// two outputs never share an entry.
//
// It was returned to the caller and then DROPPED: `setApproval` persisted the bare
// result, so the review card in Decisions rendered a deterministic template's
// verdict in exactly the grammar it renders a model's. A recruiter ratifying an
// "AI review" deserves to know when no AI was involved — the same disclosure rule
// the analysis report's EngineNote already applies to machine prose.
//
// FIELD NAME. The obvious `source` is TAKEN on this payload: Scorecard.source is
// "ai" | "human" (who CONDUCTED the interview — app/_lib/interview-scorecard.ts),
// read by the review card's `isHumanScorecard`. Two different questions, so two
// different fields: `verdictSource` is which ENGINE produced the verdict.
export const VERDICT_SOURCES = ["llm", "template"] as const;
export type VerdictSource = (typeof VERDICT_SOURCES)[number];

/** Persisted beside every approval payload this module writes. `provider` is the
 *  configured routing target for the `automation` use case — null on a template
 *  verdict, where no provider was asked. */
export type VerdictProvenance = { verdictSource: VerdictSource; verdictProvider: string | null };

/** The CLI's `source` word, read as an engine. Anything that is not literally
 *  "llm" is a template serve — "deterministic" today, and any future degrade word
 *  fails to the honest side rather than claiming the model answered. */
export function verdictSourceOf(source: string): VerdictSource {
  return source === "llm" ? "llm" : "template";
}

/** The provider the `automation` use case routes to, for the disclosure line. Read
 *  from the SAME config buildLlmConfigEnv serializes into KP_LLM_CONFIG, so the
 *  label names the engine the spawn was actually pointed at. An unconfigured
 *  install falls through to the Claude CLI (buildLlmConfigEnv returns `{}` and
 *  Python defaults to it), which is what the label then says. Never throws — a
 *  provenance label must not be able to fail a drafting run. */
export function automationProviderLabel(): string | null {
  try {
    const rows = listLlmConfig();
    const row = rows.find((r) => r.useCase === "automation") ?? rows.find((r) => r.useCase === "*");
    return row?.provider ?? "claude_cli";
  } catch {
    // best-effort: the disclosure degrades to "engine not named", never to a failed draft.
    return null;
  }
}

// ---- Structured event/result reasons ----------------------------------------
//
// The three places this module used to hand a reader a hard-coded ENGLISH sentence.
// Same split automation-pass.ts already runs (`reasonCode` + `reasonParams` beside a
// canonical English `reason`): a machine token the UI resolves in the reader's
// language, with the legacy prose still rendering for rows written before the codes
// existed.
//
//   • `offerAutoExtended`  — the offer_auto_extended pipeline event's detail.
//   • `rematchSkippedHired` — the rematch result's `reason`, painted verbatim by
//     PipelineCandidateResultView.
//   • the auto-ratify seal's `reasonCode` (below, at the seal itself) — resolved by
//     waveReasonText through `decisions.wave.reasons.*` like every other sealed reason.
export const AUTOMATION_REASON_CODES = ["offerAutoExtended", "rematchSkippedHired"] as const;
export type AutomationReasonCode = (typeof AUTOMATION_REASON_CODES)[number];
/** Wire prefix for a coded event detail. Parsed by the event-detail renderer
 *  (pipelineEventCatalog.ts `useEventVerb`), which cannot import this module — it
 *  is a client component and this file opens SQLite. Pinned from both sides by
 *  automation-run.test.ts. */
export const AUTOMATION_REASON_PREFIX = "reason:";
export function automationReasonDetail(code: AutomationReasonCode): string {
  return `${AUTOMATION_REASON_PREFIX}${code}`;
}

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
  if (!(task in AUTOMATION_VERSION)) throw new AutomationError(`unknown task: ${task}`, 404, "unknown_task");
  // Tenant (P1): the entry read + every downstream mutation scope to the entry's own team
  // (passed by the batch sweep as entry.workspaceId, or by the route as currentWorkspace()).
  // The recordAutomationEvent calls' EVENTS auto-derive their tenant from the entry, so they
  // stay correct regardless; threading workspaceId keeps their label/title enrichment right.
  const entry = getPipelineEntry(entryId, workspaceId);
  if (!entry) throw new AutomationError("entry not found", 404, "entry_not_found");
  if (!entry.candidateId) throw new AutomationError("entry has no candidate profile", 400, "entry_has_no_profile");
  const rec = getProfileRecord(entry.candidateId, workspaceId);
  if (!rec) throw new AutomationError("candidate profile not found", 400, "entry_has_no_profile");

  // Rematch REDIRECTS a candidate to a better-fit role and closes out their current
  // entry (idea-9ad8a777). A Hired candidate is placed — never redirect them, and
  // short-circuit BEFORE the LLM/corpus hop so a placed person is neither charged a
  // model call nor forked into a second active funnel. (The "Explore alternatives"
  // action is UI-gated to pre-terminal stages; this also guards the direct API /
  // background-task path.) Resolved by ROLE, not the literal "Hired": a workspace
  // that renamed its final column must not start re-matching its placed hires.
  if (task === "rematch" && stageHasRole(entry.stage, "terminal", getPipelineAxis(workspaceId).stages)) {
    return {
      // `reason` stays the canonical English (older clients paint it verbatim);
      // `reasonCode` is the structured mirror PipelineCandidateResultView resolves
      // through `pipeline.result.reasons.*` in the reader's language.
      result: { found: false, reason: "candidate is hired; rematch skipped", reasonCode: "rematchSkippedHired" },
      source: "skipped",
      applied: "skipped_hired",
    };
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
  // Scoped like every other read in this function. listCorpusJobs is dual-tier —
  // `(workspace_id IS NULL OR workspace_id = ?)`, the shared seeded corpus PLUS this
  // team's own published roles — so a bare call scored the candidate against the
  // corpus plus the DEFAULT team's openings and never against the caller's. Three
  // effects: a team's own better-fit role was invisible (rematch reported
  // no_alternative); when it did fire it planted an entry in this team pointing at
  // ANOTHER team's job id; and the corpus fingerprint below was computed over the
  // wrong set, so publishing or closing a role never invalidated the 168h cache.
  const corpusJobs = task === "rematch" ? listCorpusJobs(workspaceId) : null;
  // GH7 — serialize the entry's compact GitHub evidence ONCE for the tasks whose
  // prompts consume it (GITHUB_EVIDENCE_TASKS = screen/prep/scorecard): the same
  // bytes are written to github.json for Python below AND folded into the cache
  // key, so a refreshed deep-dive — or evidence appearing on a previously bare
  // entry — invalidates the 168h cache instead of a stale HIT serving a verdict
  // the AI formed without it. Mirrors the profileJson serialize-once pattern.
  const githubEvidenceJson =
    GITHUB_EVIDENCE_TASKS.has(task) && entry.githubEvidence ? JSON.stringify(entry.githubEvidence) : null;
  // THE INTERVIEW THE LETTER FOLLOWS FROM. It sat on this entry the whole time and
  // was never passed: the post-interview rejection was drafted from CV + score +
  // stage, so its "decisive reason" could only come from the CV (or from nothing —
  // one live draft invented "another candidate matched more closely"), and the offer
  // letter could open with unqualified enthusiasm over a `hold` scorecard. Null when
  // the entry has no interview, which the prompts read as "none happened".
  const interviewScorecard = SCORECARD_TASKS.has(task)
    ? (latestInterviewByEntry(entryId, workspaceId)?.scorecard ?? null)
    : null;
  const scorecardJson = interviewScorecard ? JSON.stringify(interviewScorecard) : null;
  // Letter tasks render in the entry's resolved comms locale (pa-l2-null-locale):
  // resolved HERE — not left to the CV-language guess inside Python — so the
  // letter provably matches the locale comms-dispatch wraps it in.
  // …resolved in the ENTRY'S OWN TEAM (lib-comms-11: the last untenanted letter-locale
  // site). resolveCommsLocale falls back to a WORKSPACE default_locale for a NULL-locale
  // candidate, and an omitted id reads the DEFAULT workspace's — so a legacy-locale
  // candidate filed into a team that set its own language got the letter BODY drafted in
  // the default team's language while comms-dispatch wrapped it in their own team's
  // chrome. `entry.workspaceId` is the row's OWN tenant (rowToEntry always carries it,
  // defaulting a legacy NULL column to the default team) — the same value
  // comms-dispatch.candidateLocale threads, so the drafted body and the dispatched
  // wrapper now resolve their language from one authority.
  const letterLang = LETTER_TASKS.has(task) ? resolveCommsLocale(entry.locale, entry.workspaceId) : undefined;
  // Recruiter-narrative tasks (prep/screen/scorecard) render in the caller's UI
  // locale when it passed one (getServerLocale, request scope), else the org's
  // configured language (the workspace default) — so a background pass localizes
  // too, never a silent English default. Mirrors resolveCommsLocale's fallback.
  const uiLang: Locale | undefined = UI_LANG_TASKS.has(task)
    ? isLocale(lang)
      ? lang
      // …the ENTRY'S OWN team's default, not a fixed tenant's. A bare
      // getWorkspaceDefaultLocale() read the DEFAULT workspace, so a background pass
      // over a team that set its own language wrote that team's screening rationale,
      // interview prep and scorecard summary in the default team's language — the same
      // untenanted defect the letter locale had one line below. The resolved locale is
      // a cache-key axis, so non-default teams re-key and their wrongly-shared entries
      // self-invalidate; the default team's keys are byte-identical.
      : getWorkspaceDefaultLocale(entry.workspaceId)
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
    // The interview evidence is a key axis of its own (mirrors the GH7 one): a
    // scorecard synthesized AFTER a first draft leaves candidateId/jobId/stage/lang
    // all unchanged, so without it the 168h TTL would keep serving the letter that
    // was drafted blind to the interview - the exact defect this change fixes.
    scorecardJson: scorecardJson ?? undefined,
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
      // The interview the letter follows from (rejection/offer). Written like
      // profile.json/github.json — the SAME bytes folded into the cache key above,
      // so a scorecard synthesized after a first draft invalidates the cached,
      // ungrounded letter instead of serving it for the rest of the TTL.
      if (scorecardJson) {
        const scorecardPath = path.join(workdir, "scorecard.json");
        await writeFile(scorecardPath, scorecardJson, "utf-8");
        args.push("--scorecard-file", scorecardPath);
      }
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
  // WHICH ENGINE ANSWERED, carried onto everything this run persists. Computed once
  // from the CLI's own word (a cache HIT keeps the source it was stored with, which is
  // why the degrade is a cache-key axis), then stamped on (a) every approval payload, so
  // the Decisions review card can disclose a template verdict, and (b) every automation
  // event's ACTOR — the structured "who acted" column the decision log already parses
  // ("auto:<engine>"), rather than the parsed `detail`, which several kinds own.
  const verdictSource = verdictSourceOf(payload.source);
  const verdictProvider = verdictSource === "llm" ? automationProviderLabel() : null;
  const provenance: VerdictProvenance = { verdictSource, verdictProvider };
  const engineActor = `auto:automation-${verdictSource}`;
  /** The approval payload the recruiter's card reads: the model's/template's result
   *  plus the provenance. Spread order is deliberate — provenance is written by THIS
   *  module and must not be shadowed by a same-named key coming out of Python. */
  const approvalDetail = (): string => JSON.stringify({ ...result, ...provenance });
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
      setApproval(entry.id, "screening_review", approvalDetail(), workspaceId);
      recordAutomationEvent(entry.id, "screening_hold", readRecommendation(result, task), workspaceId, engineActor);
      // interviewPlan screeningGate="auto" — the workspace chose to trust the
      // AI's ADVANCE verdicts: a review parked only for confidence (recommendation
      // advance, route hold) is ratified unattended through the SAME accept
      // machinery a recruiter's click uses (advance + calendar gate + auto_advanced
      // event), CAS-guarded on the approval just set. hold/reject recommendations
      // ALWAYS park — auto mode never overrides a cautious or adverse verdict.
      if (
        getPlanGateForRole("screening", workspaceId) === "auto" &&
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
            // Resolved through `decisions.wave.reasons.*` by waveReasonText, the ONE
            // sealed-reason resolver the records panel + decision log share — so this
            // rationale reads in the auditor's language instead of falling back to the
            // byte-stable English. A dedicated code, not the generic "accept" a human
            // acceptance seals: the two are different decisions with different readers.
            reasonCode: "autoRatifiedScreening",
            inputs: { fromStage: entry.stage, approvalKind: "screening_review" },
          });
          applied = "auto_ratified";
        }
      }
    }
    if (applied !== "auto_ratified") applied = screenApplied;
  } else if (task === "scorecard") {
    setApproval(entry.id, "scorecard_review", approvalDetail(), workspaceId);
    recordAutomationEvent(entry.id, "interview_scorecard", readRecommendation(result, task), workspaceId, engineActor);
    applied = "scorecard_ready";
  } else if (task === "offer") {
    setApproval(entry.id, "offer_review", approvalDetail(), workspaceId);
    recordAutomationEvent(entry.id, "offer_drafted", String(result.recommended ?? ""), workspaceId, engineActor);
    applied = "offer_ready";
    // interviewPlan offerGate="auto" — extend the freshly-drafted offer to the
    // candidate unattended, through the SAME extend path a recruiter's approval
    // uses (idempotent open-offer reuse, truthful sent/queued dispatch, sealed
    // offer_terms with the machine as actor). Three hard guards:
    //   • an UNPRICED fail-safe draft (recommended null — no figure was willing
    //     to be invented) ALWAYS parks for a human to price it;
    //   • the extend runs on the FRESH row (the approval just written), so a
    //     concurrent decision can't be clobbered;
    //   • a THIRD guard, added after a live draft was auto-sent on an entry whose own
    //     interview scorecard said `hold` (2 of 5 technical): a recorded verdict that
    //     contradicts the send parks the draft for a human. See offerAutoExtendRefusal
    //     — it refuses the send, it does not touch the letter, and it is silent for the
    //     `advance` and no-interview cases the gate was configured for.
    // Origin "" → publicBaseUrl resolves the configured/canonical public origin
    // (never a request Host), which is exactly right for a background extend.
    const offerGateIsAuto = getPlanGateForRole("offer", workspaceId) === "auto";
    const scorecardRefusal = offerGateIsAuto ? offerAutoExtendRefusal(interviewScorecard) : null;
    if (scorecardRefusal) {
      console.warn(
        `[automation:offer] auto-extend withheld (${scorecardRefusal}); the interview verdict on this entry ` +
          `does not support an unattended offer — draft parked at offer_review for human approval`
      );
    }
    if (offerGateIsAuto && result.recommended != null && !scorecardRefusal) {
      const fresh = getPipelineEntry(entry.id, workspaceId);
      if (fresh && fresh.approvalKind === "offer_review") {
        try {
          const extended = await extendDraftedOffer(fresh, workspaceId, "", null, "auto:interview-plan");
          // A REFUSAL IS NOT A SEND. extendDraftedOffer never throws for a business
          // rule — it RETURNS { status, body } — and this block used to ignore that
          // entirely, so a 400 (invalid offer terms), a 502 (the letter did not
          // dispatch) or a 409 (the approval moved while it sent) all stamped
          // `offer_auto_extended` on the timeline and reported `applied: "offer_sent"`
          // to the caller. The recruiter was told an offer went out that did not.
          // Now the draft parks exactly as it does for a thrown error: `applied` is
          // left as the "offer_ready" the branch above set, so the card stays at
          // offer_review for a human, and the timeline records WHY.
          if (extended.status !== 200) {
            const code = typeof extended.body.code === "string" ? extended.body.code : "OFFER_NOT_EXTENDED";
            // The refusal CODE is the record; the SCREEN shows the kind's own
            // localized verb. Deliberately NOT a resolvable `reason:<code>` — the
            // renderer's parser accepts letters only (pipeline-event-reasons.test.ts
            // §3), so a detail carrying an UPPER_SNAKE refusal code falls through to
            // the localized kind label instead of painting English prose at a Czech
            // recruiter. Same kind extendDraftedOffer's own 502 path writes: nothing
            // went out, the approval is still open, approving again retries.
            recordAutomationEvent(
              entry.id,
              "offer_comms_failed",
              `${AUTOMATION_REASON_PREFIX}offerAutoExtendRefused:${code}`,
              workspaceId,
              engineActor
            );
            console.error(`[automation:offer] auto-extend refused (${extended.status} ${code}); draft parked for human approval`);
          } else {
            recordAutomationEvent(entry.id, "offer_auto_extended", automationReasonDetail("offerAutoExtended"), workspaceId, engineActor);
            applied = "offer_sent";
          }
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
        // A redirected candidate has already been assessed, so they land where an
        // already-screened person belongs on THIS workspace's axis — not on a
        // column that happens to be called "Screened".
        stage: screenedLandingStage(getPipelineAxis(workspaceId).stages),
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
    recordAutomationEvent(entry.id, DRAFT_EVENT[task] ?? task, "", workspaceId, engineActor);
    applied = "drafted";
  }

  return { result, source: payload.source, applied };
}
