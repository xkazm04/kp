// The LLM deep-dive for ONE shortlisted posting: re-structure the advertisement with the
// model (`jobs_cli ingest`, use case jd_ingest — the same parser a recruiter's pasted ad
// goes through), re-match that one posting so its score and eligibility flags reflect
// the richer Job, then write the match rationale (`reasoning_cli`, use case
// match_reasoning) onto the row. Three spawns, two of them model calls, so the scan
// runs it only for `deepDive.maxPerScan` postings at or above `deepDive.threshold`.
//
// KEYLESS IS A DECISION, NOT A FAULT. There is no TS-side "is a provider configured"
// oracle (llm-config.ts stores keys; availability is the Python registry's call), so the
// first step doubles as the probe: jobs_cli refuses with "No LLM provider available" when
// nothing can be resolved for jd_ingest, and reasoning_cli answers `source:
// "deterministic"` when a provider passed the gate but nothing came back. Either one is
// `no_provider` to the caller, which stops the shortlist there — one cheap spawn per scan
// keyless, never ten. A deterministic rationale is NEVER persisted: `reasoning_json IS NOT
// NULL` means "deep-dived", and storing the template would freeze the posting out of an
// upgrade the moment a key arrives (the recruiter-side cache policy makes the same call).

import { setPostingMatch, setPostingReasoning, setPostingStructure } from "../db/jobseeker-postings";
import { DEFAULT_WORKSPACE_ID } from "../db/workspaces";
import { matchChunk, MATCH_VERSION } from "./match";
import { isNoProviderError, runPythonCli, type CliRunner } from "./python-cli";
import type { JobseekerPosting, JobseekerProfile } from "./types";

/** Above this the ad is truncated for the parser — a posting body is a few kB; 40 kB is a
 *  page that embedded its whole site. */
const MAX_AD_CHARS = 40_000;
/** jobs_cli / reasoning_cli build their provider with timeout=120; the spawn backstop
 *  sits above it so a slow-but-valid parse is the provider's timeout, not ours. */
const LLM_SPAWN_TIMEOUT_MS = 180_000;

export type DeepDiveDeps = {
  runCli: CliRunner;
  setPostingStructure: typeof setPostingStructure;
  setPostingMatch: typeof setPostingMatch;
  setPostingReasoning: typeof setPostingReasoning;
  now: () => string;
  log: (line: string, error?: unknown) => void;
};

export const defaultDeepDiveDeps: DeepDiveDeps = {
  runCli: runPythonCli,
  setPostingStructure,
  setPostingMatch,
  setPostingReasoning,
  now: () => new Date().toISOString(),
  log: (line, error) => (error === undefined ? console.warn(`[jobseeker:deepdive] ${line}`) : console.error(`[jobseeker:deepdive] ${line}`, error)),
};

export type DeepDiveOutcome =
  /** The rationale came from a model and is persisted — unless `moved`: the posting's
   *  content changed while the dive was out at the model, so nothing it computed was
   *  written over the new ad (the next scan structures and scores the new content). */
  | { kind: "done"; source: "llm"; reasoning: Record<string, unknown>; restructured: boolean; rematched: boolean; moved: boolean }
  /** Not persisted: the engine served its template. The caller stops the shortlist. */
  | { kind: "deterministic"; source: "deterministic"; reasoning: Record<string, unknown>; restructured: boolean }
  /** Not persisted, nothing spent: no provider resolves for jd_ingest. */
  | { kind: "no_provider" };

/** The text the ad parser reads: the header the source gave us, then the body. */
export function adTextFor(posting: Pick<JobseekerPosting, "title" | "company" | "location" | "bodyText">): string {
  const header = [posting.title, [posting.company, posting.location].filter(Boolean).join(" — ")].filter(Boolean).join("\n");
  return `${header}\n\n${posting.bodyText}`.slice(0, MAX_AD_CHARS);
}

export async function deepDivePosting(
  posting: JobseekerPosting,
  profile: JobseekerProfile,
  opts: { lang?: string; signal?: AbortSignal; workspaceId?: string; inputsAt?: string; deps?: Partial<DeepDiveDeps> } = {}
): Promise<DeepDiveOutcome> {
  const deps: DeepDiveDeps = { ...defaultDeepDiveDeps, ...opts.deps };
  const ws = opts.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const lang = opts.lang ?? "en";
  // The re-match's stamp is the time its INPUTS were read (the caller's profile read; the
  // scan passes its own), never the moment the dive finished: a preferences edit saved
  // mid-dive must postdate matchedAt, or the row reads as current and is never re-matched.
  const inputsAt = opts.inputsAt ?? deps.now();
  let job: Record<string, unknown> | null = posting.job;
  let restructured = false;
  let rematched = false;
  // Every write re-asserts the content hash this dive read (compare-and-swap, not a lock:
  // the model calls take minutes and must not hold one). The first refusal means the ad
  // moved under us; every later write is skipped, and it is said once.
  const guard = { expectedContentHash: posting.contentHash };
  let moved = false;
  const markMoved = (step: string) => {
    if (!moved) deps.log(`${posting.id}: content changed during the deep-dive (${step}), nothing written over the new ad`);
    moved = true;
  };

  // 1. Model structuring. The keyless refusal ends the deep-dive before any model spend;
  //    any other failure keeps the deterministic Job — the rationale is still worth having.
  try {
    const out = await deps.runCli({
      module: "jobs_cli",
      files: { "ad.txt": adTextFor(posting) },
      args: (f) => ["ingest", "--ad-file", f["ad.txt"], "--job-id", posting.id],
      signal: opts.signal,
      llm: true,
      timeoutMs: LLM_SPAWN_TIMEOUT_MS,
    });
    if (out.job && typeof out.job === "object" && out.source === "llm") {
      job = { ...(out.job as Record<string, unknown>), id: posting.id };
      if (deps.setPostingStructure(posting.id, job, "llm", ws, guard)) restructured = true;
      else markMoved("structure");
    }
  } catch (error) {
    if (isNoProviderError(error)) return { kind: "no_provider" };
    deps.log(`${posting.id}: model structuring failed, keeping the deterministic job`, error);
  }
  if (!job) {
    // A posting reaches the shortlist only through a match, and a match needs a Job; a
    // row with neither is a scan ordering bug, not something to reason about.
    deps.log(`${posting.id}: no structured job on the row, skipping`);
    return { kind: "deterministic", source: "deterministic", reasoning: {}, restructured: false };
  }

  // 2. Re-match ONLY this posting so the indexed total/eligibility reflect the richer
  //    Job (a deterministic spawn, no model). A KO here leaves the previous match in place
  //    — the row already carries a score the seeker saw, and "not comparable" would be a
  //    silent demotion; the rationale below says what changed.
  if (restructured && !moved) {
    try {
      const { matched } = await matchChunk(profile, [{ id: posting.id, job }], deps.runCli, opts.signal);
      const hit = matched.find((m) => m.id === posting.id);
      if (hit) {
        const projection = { total: hit.total, fitTier: hit.fitTier, version: MATCH_VERSION, matchedAt: inputsAt };
        if (deps.setPostingMatch(posting.id, hit.match, projection, ws, guard)) rematched = true;
        else markMoved("match");
      }
    } catch (error) {
      deps.log(`${posting.id}: re-match after model structuring failed, keeping the earlier score`, error);
    }
  }

  // 3. The rationale. `--jobs` names a one-job corpus so the seed corpus never loads and
  //    `--job-id` resolves to this posting; `--profile-json` is the seeker's own profile.
  const out = await deps.runCli({
    module: "reasoning_cli",
    files: { "profile.json": profile.profile, "corpus.json": [{ ...job, id: posting.id }] },
    args: (f) => ["--profile-json", f["profile.json"], "--jobs", f["corpus.json"], "--job-id", posting.id, "--lang", lang],
    signal: opts.signal,
    llm: true,
    timeoutMs: LLM_SPAWN_TIMEOUT_MS,
  });
  const reasoning = out.reasoning && typeof out.reasoning === "object" ? (out.reasoning as Record<string, unknown>) : {};
  if (out.source !== "llm") return { kind: "deterministic", source: "deterministic", reasoning, restructured };
  const stored = {
    reasoning,
    source: "llm",
    narrativeLang: typeof out.narrativeLang === "string" ? out.narrativeLang : lang,
    promptVersion: typeof out.promptVersion === "string" ? out.promptVersion : null,
    total: typeof out.total === "number" ? out.total : null,
    at: deps.now(),
  };
  if (!moved && !deps.setPostingReasoning(posting.id, stored, ws, guard)) markMoved("reasoning");
  return { kind: "done", source: "llm", reasoning, restructured, rematched, moved };
}
