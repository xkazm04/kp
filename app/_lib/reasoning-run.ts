import { writeFile } from "node:fs/promises";
import path from "node:path";
import { meterAllows } from "./billing";
import { lookupPromptCache, storePromptCache } from "./db/analyses";
import { getJob, listCorpusJobs } from "./db/jobs";
import { buildLlmConfigEnv } from "./llm-config";
import { resolveMatchInput, materializeMatchInput, type MatchInputBody } from "./match-input";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { computeCorpusFingerprint } from "./automation-cache-key";
import { reasoningCacheKey } from "./reasoning-cache-key";
import { isCacheableReasoning, narrativeLangFor } from "./reasoning-cache-policy";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { isLocale } from "@/i18n/locales";

// v4 (scan-sweep 2026-08-24): the engine-language collapse below was fixed in
// the same batch, so every de/fr slot written in the last 168h holds ENGLISH
// prose under a de/fr key — generated with --lang en, keyed on the request.
// Nothing in a stored payload records its language, so those slots would now
// be served stamped narrativeLang="de" and suppress the panel's honest note.
// Bumping retires them; en/cs slots are correct today and are retired too,
// which buys the correctness with one round of recompute.
//
// Must match pipeline/jobfit/match_reasoning.py::REASONING_PROMPT_VERSION — a
// drift here leaves the reasoning cache silently stale. The pairing is enforced
// by pipeline/jobfit/tests/test_prompt_version_sync.py (CI fails on divergence).
// Exported so the cache-first test can reconstruct the exact key runReasoning uses.
export const REASONING_PROMPT_VERSION = "match-reasoning-v4";
const CACHE_TTL_HOURS = 168;

export class ReasoningError extends Error {
  status: number;
  /**
   * The runner's stable machine code — "not_found" / "invalid_input" /
   * "engine_error", the same vocabulary `parseStderrError` (python-runner.ts)
   * already produces. It used to be dropped here, so /api/match/reasoning
   * re-derived a code from the HTTP status and answered "the candidate or role
   * behind it is gone" for a request that named no candidate at all. Two
   * different remedies — fix the request vs refresh the grid — wore one
   * sentence. Every throw site below stamps one; see reasoning-error-code.test.ts.
   */
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// MAT1 — `lang` is the recruiter's locale for the verdict/strengths/gaps
// narrative, captured at request scope (the detached task can't read the cookie)
// and validated upstream. Defaults to "en".
export type ReasoningInput = MatchInputBody & { jobId?: string; lang?: string };

// Shared core for /api/match/reasoning AND the background-task runner.
//
// Tenancy: `workspaceId` scopes BOTH the candidate/analysis resolution (writeMatchInput)
// AND the live corpus (listCorpusJobs) to the caller's tenant — /api/match already
// scoped its corpus; this closes the same divergence on the reasoning path. Request
// callers pass currentWorkspace(); the background-task runner passes ctx.workspaceId
// (the enqueuer's tenant). getJob(jobId) stays a by-id point read (globally-unique PK,
// jobs-tenancy exempt): it only content-addresses the cache key, and the scoped corpus
// is what decides which record --job-id actually resolves against.
export async function runReasoning(
  body: ReasoningInput,
  signal?: AbortSignal,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<Record<string, unknown>> {
  if (!body.jobId) throw new ReasoningError("jobId is required.", 400, "invalid_input");
  // The engine narrative supports EVERY shipped locale: pipeline/jobfit/i18n.py
  // LANG_NAMES carries en/cs/de/fr and `language_directive` names German and
  // French, so `--lang de|fr` reaches the prompt as its own language. This used to
  // read `requestedLang === "cs" ? "cs" : "en"` — a collapse justified by a comment
  // claiming the engine was en/cs-only. That claim went stale when the Python side
  // gained de/fr (guarded by its own test_prompt_locale.py
  // ::test_every_shipped_locale_reaches_the_prompt_as_ITSELF), leaving a German or
  // French recruiter with an English rationale plus a "shown in English" note —
  // honest, but a needless degradation for half the shipped locales. Pass the
  // requested locale straight through; normalize_lang on the Python side fails safe
  // to en for anything it doesn't know, so an unexpected value can't reach a prompt
  // as an unknown language.
  //
  // The cache is keyed by this same locale (a de request has always had its OWN
  // slot, never the en one), and narrativeLang reports the language the text was
  // actually produced in so the UI can still flag a deterministic English fallback.
  const requestedLang = isLocale(body.lang) ? body.lang : "en";
  const engineLang = requestedLang;

  // Cache-first (Direction 2): resolve the candidate/profile and read the corpus
  // from the DB — but write NOTHING to disk and spawn NOTHING yet. The full 5-axis
  // key is computable from these reads alone, so a cache HIT returns here having
  // paid zero Python-spawn and zero corpus/candidate serialization. Only a MISS
  // creates a workdir, serializes the inputs + corpus, and spawns the CLI.
  const input = resolveMatchInput(body, workspaceId);
  // match-input resolves against the DB, so its 404 is a genuinely absent profile/
  // analysis and its 400 is a malformed pair — the same two codes the Python runner
  // emits, so the route has ONE vocabulary to forward whichever side refused.
  if ("error" in input)
    throw new ReasoningError(input.error, input.status, input.status === 404 ? "not_found" : "invalid_input");
  // Same live-corpus hand-off as /api/match: a recruiter-ingested --job-id must
  // resolve here instead of raising "job not found" against the static seed. Read
  // now (a DB read, NOT a serialization) because its fingerprint is a cache axis.
  const corpusJobs = listCorpusJobs(workspaceId);

  // Content-address the job (not just its id) so an in-place edit to the job's
  // requirements/title invalidates the cached verdict — symmetric with the
  // profile content hash in input.keyPart. The locale is a fourth axis so a
  // cached cs verdict never serves an en session. The corpus fingerprint is a
  // fifth: the --jobs-json corpus decides WHICH record --job-id resolves to
  // (DB override vs seed), so a verdict must not survive a corpus change —
  // same self-invalidation contract as rematch's computeCorpusFingerprint.
  // See reasoning-cache-key.ts.
  const hash = reasoningCacheKey({
    promptVersion: REASONING_PROMPT_VERSION,
    candidateKeyPart: input.keyPart,
    jobId: body.jobId,
    jobPayload: getJob(body.jobId),
    lang: requestedLang,
    corpusFingerprint: computeCorpusFingerprint(corpusJobs.map((j) => j.id)),
  });
  const cached = lookupPromptCache(hash, REASONING_PROMPT_VERSION);
  if (cached) return { ...(cached as object), cached: true, narrativeLang: engineLang };

  let workdir: string | null = null;
  try {
    workdir = await createWorkdir();
    const inputArgs = await materializeMatchInput(input, workdir);
    const args = [
      "-m",
      "pipeline.jobfit.reasoning_cli",
      ...inputArgs,
      "--job-id",
      String(body.jobId),
      "--lang",
      engineLang,
    ];
    // The CLI augments the seed with these records (DB wins on id collision).
    if (corpusJobs.length > 0) {
      const jobsPath = path.join(workdir, "jobs.json");
      await writeFile(jobsPath, JSON.stringify(corpusJobs), "utf-8");
      args.push("--jobs-json", jobsPath);
    }
    // Billing degrade (docs/features/billing/README.md): past the AI-candidates allowance the
    // rationale falls back to the deterministic template via --no-llm — the
    // same path a provider outage takes — and stays uncached (source !=
    // "llm"), so it upgrades the moment allowance returns. No extra debit:
    // reasoning is part of the analyze-debited candidate bundle.
    // …on THIS team's allowance. Unscoped, this read the DEFAULT team's meter, so a
    // non-default team got template rationales while its own allowance was untouched,
    // and kept its LLM rationales after the default team ran out. (automation-run.ts
    // passes the same argument for the same reason.)
    if (!meterAllows("ai_candidates", { workspace: workspaceId })) args.push("--no-llm");

    const { result } = spawnPython(args, { signal, env: buildLlmConfigEnv() });
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      throw new ReasoningError(err.message, err.status, err.code);
    }
    // parsePythonJson, not raw JSON.parse (idea-37493de3): reasoning_cli invokes
    // an LLM, and the interpreter can print shutdown chatter after the JSON line
    // — a successful, PAID reasoning call must not throw here (and skip the
    // cache!) because asyncio logged 'Event loop is closed'.
    const data = parsePythonJson<Record<string, unknown>>(stdout, stderr);
    // Persist authoritative LLM verdicts only; a deterministic fallback is left
    // uncached so it is recomputed (and upgraded) the moment the provider returns.
    // See reasoning-cache-policy.ts for the full invalidation contract.
    if (isCacheableReasoning(data)) {
      storePromptCache(hash, data, REASONING_PROMPT_VERSION, CACHE_TTL_HOURS);
    }
    // narrativeLang must state the language the text was actually PRODUCED in.
    // The deterministic fallback above (--no-llm, or a provider outage) is
    // English-only by construction, so stamping the requested locale on it
    // suppressed the panel's honest "shown in English" note. The cache-HIT
    // branch keeps engineLang unconditionally and is correct: only "llm"
    // payloads are ever stored (isCacheableReasoning).
    return { ...data, cached: false, narrativeLang: narrativeLangFor(data, engineLang) };
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
