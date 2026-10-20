import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getJob } from "./db/jobs";
import { getPipelineEntry } from "./db/pipeline";
import { latestInterviewByEntry } from "./db/interviews";
import { interviewLetterById, interviewLetterSaveDraft } from "./db/interview-letters";
import { kitById } from "./interview-kit";
import { consentWithholdsPii } from "./consent";
import { buildLlmConfigEnv } from "./llm-config";
import { namespaceTranslator } from "./catalog-translator";
import { buildInterviewLetterTemplate } from "./interview-letter-template";
import { letterTextProblem, type LetterOutcome } from "./interview-letter-policy";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, PipelineError, spawnPython } from "./python-runner";
import type { LetterDraftSource } from "./interview-letter-types";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";

// Draft the interview FEEDBACK LETTER a candidate asked for (spark
// interview-feedback-letter, WP-alpha). Runs as the `interview_letter` background task
// (tasks.ts), queued by the candidate's own request door (POST /api/status/[token]/letter)
// and — in WP-beta — by a recruiter's "draft again".
//
// Its own path rather than `runAutomationTask`, for the reason the interview KIT has one:
// that runner refuses a decided entry on a manual run and needs a CV profile, and a letter
// is by definition about a decided entry and must never read the CV. The shape is the kit's
// (interview-kit-run.ts): write the inputs into a temp workdir, spawn the candidate-free
// `automation_cli interview-letter`, coerce the envelope, store the result.
//
// KEYLESS IS A SUPPORTED PATH. When no model is configured — or the model's letter failed
// one of the drafting CLI's checks and was discarded — the CLI answers with an EMPTY body
// and the competency names, and this runner builds the catalog template
// (interview-letter-template.ts) in the candidate's language. The stored draft's `source`
// says which one the recruiter is reading.
//
// NOTHING ABOUT THE LETTER RIDES ON THE TASK RESULT. The `tasks` table is not reached by
// the erasure scrub (ERASURE_EXEMPT["tasks"]), so the result carries the engine, the
// language and whether a draft was stored — never the text, never the candidate's name.
// The draft lives on the interview_letters row, which the scrub does blank.

export type InterviewLetterPayload = {
  /** The model's letter, or "" when the keyless / discarded path served. */
  body: string;
  /** Canonical rubric competency names — the ONLY interview facts the letter may carry. */
  wentWell: string[];
  toWorkOn: string[];
  promptVersion: string | null;
};

export type InterviewLetterRunResult = {
  letterId: string;
  /** The engine: `llm` only when the model's letter survived every check. */
  source: "llm" | "deterministic";
  /** What the stored draft is — `model` or the catalog `template`. */
  draftSource: LetterDraftSource;
  lang: Locale;
  promptVersion: string | null;
  /** False when nothing was stored: the row moved (a person decided, or it was erased)
   *  while the draft was being prepared, or the candidate's consent is now withheld. */
  saved: boolean;
};

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
}

/** Shape-check the CLI envelope. Pure and exported so the parse contract is unit-testable
 *  without spawning Python (the kit's `toInterviewKitEnvelope` precedent). Throws on a
 *  malformed envelope — the task fails and the letter stays `requested`, never half-drafted. */
export function toInterviewLetterEnvelope(payload: unknown): { result: InterviewLetterPayload; source: "llm" | "deterministic" } {
  const p = payload as { result?: Record<string, unknown>; source?: unknown } | null;
  const r = p?.result;
  if (!r || typeof r !== "object" || typeof r.body !== "string") {
    throw new Error("automation_cli interview-letter returned an unexpected envelope (missing result.body).");
  }
  return {
    result: {
      body: r.body,
      wentWell: stringList(r.wentWell),
      toWorkOn: stringList(r.toWorkOn),
      promptVersion: typeof r.promptVersion === "string" ? r.promptVersion : null,
    },
    // Anything but an explicit "llm" is the template: a source the runner cannot read must
    // never be reported to the recruiter as a model's writing.
    source: p?.source === "llm" ? "llm" : "deterministic",
  };
}

/** The CLI's argv, built where it can be read without spawning anything. `--scorecard-file`
 *  is omitted rather than pointed at an empty file when no scorecard exists: "no interview
 *  record" and "an empty one" must not look the same to the drafter. */
export function interviewLetterArgs(specPath: string, scorecardPath: string | null, lang: Locale): string[] {
  return [
    "-m",
    "pipeline.jobfit.automation_cli",
    "interview-letter",
    "--letter-json",
    specPath,
    ...(scorecardPath ? ["--scorecard-file", scorecardPath] : []),
    "--lang",
    lang,
  ];
}

/** Which draft to store: the model's letter when the engine says it wrote one AND it
 *  passes the contract's own write check, else the catalog template. Pure — the choice is
 *  the part of this runner a recruiter's trust rests on, so it is pinned by test. */
export function chooseLetterDraft(
  envelope: { result: Pick<InterviewLetterPayload, "body">; source: "llm" | "deterministic" },
  templateText: string
): { text: string; source: LetterDraftSource } {
  const body = envelope.result.body.trim();
  if (envelope.source === "llm" && body && letterTextProblem(body) === null) return { text: body, source: "model" };
  return { text: templateText, source: "template" };
}

/** The kit competency titles of the kit version this interview was PINNED to — what the
 *  conversation was built around. Empty when the session ran without a kit. */
function pinnedKitTitles(kitId: string | null, workspaceId: string): string[] {
  if (!kitId) return [];
  const kit = kitById(kitId, workspaceId);
  return kit ? kit.kit.competencies.map((c) => c.title).filter((t) => typeof t === "string" && t.trim().length > 0) : [];
}

export async function runInterviewLetter(letterId: string, signal: AbortSignal | undefined, workspaceId: string): Promise<InterviewLetterRunResult> {
  // OWNERSHIP, asserted here and not only at the door: this runner is also reachable
  // through POST /api/tasks with CLIENT-SUPPLIED params, so the letter id must resolve
  // inside the enqueuing team or not at all (the same "unknown" answer for a foreign id).
  const letter = interviewLetterById(letterId, workspaceId);
  if (!letter) throw new Error(`interview letter not found: ${letterId}`);
  const lang: Locale = isLocale(letter.lang) ? letter.lang : DEFAULT_LOCALE;
  const skipped: InterviewLetterRunResult = { letterId, source: "deterministic", draftSource: "template", lang, promptVersion: null, saved: false };
  // A person already decided, or the row was erased: there is nothing to draft, and a
  // draft written now would be about a letter that is closed.
  if ((letter.state !== "requested" && letter.state !== "drafted") || letter.erasedAt) return skipped;
  const entry = getPipelineEntry(letter.entryId, workspaceId);
  if (!entry) throw new Error(`pipeline entry not found for interview letter ${letterId}`);
  // Consent re-checked at draft time, not only at request time: a consent that lapsed in
  // between means no personal data is processed for this letter.
  if (consentWithholdsPii({ givenAt: entry.consentGivenAt, expiresAt: entry.consentExpiresAt, anonymizedAt: entry.anonymizedAt })) {
    return skipped;
  }

  const session = latestInterviewByEntry(entry.id, workspaceId);
  const scorecard = session?.scorecard && typeof session.scorecard === "object" ? session.scorecard : null;
  const outcome: LetterOutcome = letter.outcome;
  const spec = {
    outcome,
    jobTitle: entry.jobTitle ?? "",
    company: entry.jobId ? (getJob(entry.jobId, workspaceId)?.company ?? "") : "",
    kitTopics: pinnedKitTitles(session?.kitId ?? null, workspaceId),
  };

  const workdir = await createWorkdir();
  let envelope: ReturnType<typeof toInterviewLetterEnvelope>;
  try {
    const specPath = path.join(workdir, "letter.json");
    const scorecardPath = scorecard ? path.join(workdir, "scorecard.json") : null;
    await writeFile(specPath, JSON.stringify(spec), "utf-8");
    if (scorecardPath) await writeFile(scorecardPath, JSON.stringify(scorecard), "utf-8");
    // KP_LLM_CONFIG so the `automation` use case resolves the admin's BYOM key / routing.
    const { result } = spawnPython(interviewLetterArgs(specPath, scorecardPath, lang), { signal, env: buildLlmConfigEnv() });
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new PipelineError(parseStderrError(stderr, exitCode));
    envelope = toInterviewLetterEnvelope(parsePythonJson<unknown>(stdout, stderr));
  } finally {
    await cleanupWorkdir(workdir);
  }

  const [t, rubric] = await Promise.all([namespaceTranslator(lang, "interviewLetter.template"), namespaceTranslator(lang, "rubric.competency")]);
  const template = buildInterviewLetterTemplate(
    { outcome, jobTitle: entry.jobTitle, wentWell: envelope.result.wentWell, toWorkOn: envelope.result.toWorkOn },
    t,
    rubric
  );
  const draft = chooseLetterDraft(envelope, template);
  // Compare-and-swap: a recruiter who approved or declined — or an erasure that landed —
  // while the draft was being prepared wins, and this draft is dropped.
  const saved = interviewLetterSaveDraft(letterId, draft, workspaceId) !== null;
  return {
    letterId,
    source: draft.source === "model" ? "llm" : "deterministic",
    draftSource: draft.source,
    lang,
    promptVersion: envelope.result.promptVersion,
    saved,
  };
}
