import { createHash } from "node:crypto";

// The cache-KEY contract for per-match reasoning — the explicit, single-place
// answer to "what invalidates a cached verdict?". Kept DB-free (no ./db import)
// so it is unit-testable in isolation, mirroring reasoning-cache-policy.ts (the
// sibling cache-WRITE contract) and cache-key.ts (the analysis-cache contract).
//
// A cached rationale is reused only when ALL SIX axes match:
//
//   1. promptVersion    — REASONING_PROMPT_VERSION, the reasoning prompt/template
//                         generation. Bumping it retires every prior entry.
//   2. candidateKeyPart — the candidate identity AND content: candidateSignature
//                         for an inline candidate, or `profile:<id>:<contentHash>`
//                         for a saved profile (built in writeMatchInput). The
//                         profile is content-addressed so an in-place edit (same
//                         profileId, changed skills/aspirations) invalidates it.
//   3. job              — the job identity AND content (see jobKeyPart below).
//   4. lang             — the narrative locale.
//   5. corpusFingerprint— the live --jobs-json corpus.
//   6. workspaceId      — the tenant.
//
// Axes 4-6 are documented on their own fields in the signature below; each is
// optional with a fixed default so a caller that has nothing to say about an axis
// still keys consistently.
//
// Axis 3 closes the hole this module exists to fix: the reasoning text literally
// quotes the job's must-have and the candidate's missing skills, so editing a
// job's requirements/title in place (same id — see job-ingest.ts's upsert) must
// invalidate the cached verdict instead of serving the pre-edit rationale for the
// full TTL. Folding a content hash of the resolved Job record into the key makes
// the job axis symmetric with the content-addressed profile axis.

/**
 * Cache-key contribution of the job: its id plus a content hash of the resolved
 * Job record, so any in-place edit to the job changes the key.
 *
 * `jobPayload` is null when the job can't be resolved from the DB (the Python
 * matcher loads it from the seed corpus independently, so reasoning can still
 * run). The key then degrades to id-only — preserving prior behavior rather than
 * blocking the request — and re-tightens the moment the record is resolvable.
 */
export function jobKeyPart(jobId: string, jobPayload: unknown): string {
  if (jobPayload == null) return `job:${jobId}`;
  const contentHash = createHash("sha256").update(JSON.stringify(jobPayload)).digest("hex");
  return `job:${jobId}:${contentHash}`;
}

/**
 * Build the sha256 digest that keys a reasoning verdict in the prompt cache from
 * the six invalidation axes documented above.
 */
export function reasoningCacheKey(input: {
  promptVersion: string;
  candidateKeyPart: string;
  jobId: string;
  jobPayload: unknown;
  // MAT1 — the narrative locale is a fourth invalidation axis: without it, a
  // cached English verdict would be served to a Czech session (and vice versa).
  // Optional + defaulted to "en" so a legacy/no-lang caller keeps its key.
  lang?: string;
  // The live corpus handed to reasoning_cli via --jobs-json is a fifth axis: it
  // decides WHICH record --job-id resolves to (a DB override wins over the seed),
  // so a cached verdict must not survive a corpus change. ids-only by contract —
  // computeCorpusFingerprint (automation-cache-key.ts) — because the resolved
  // job's CONTENT is already the jobPayload axis above. Optional + defaulted to
  // "" so a legacy/no-corpus caller keeps its key.
  corpusFingerprint?: string;
  // The TENANT, as an axis of its own. runReasoning is workspace-scoped on both of
  // its DB reads, and its header comment argued the key was therefore already
  // tenant-safe: the candidate content hash and the corpus fingerprint "differ per
  // tenant anyway". That is an invariant carried by a comment, and it depends on two
  // OTHER axes never collapsing — which two workspaces seeded from the same demo
  // corpus do collapse (identical profile content, identical corpus ids). Naming the
  // workspace makes "one tenant's verdict is never served to another" a property of
  // the key instead of a consequence of the data.
  //
  // ONE-TIME INVALIDATION: adding the axis changes every key a scoped caller
  // computes, so the existing reasoning cache is retired once and the first request
  // per (candidate, job, locale, corpus, tenant) recomputes. Same accepted cost as a
  // REASONING_PROMPT_VERSION bump, and bounded by the 168h TTL either way.
  // Defaulted to "" so a caller with no tenant in hand keys consistently.
  workspaceId?: string;
}): string {
  return createHash("sha256")
    .update(
      `${input.promptVersion}|${input.candidateKeyPart}|${jobKeyPart(input.jobId, input.jobPayload)}|${input.lang ?? "en"}|${input.corpusFingerprint ?? ""}|${input.workspaceId ?? ""}`
    )
    .digest("hex");
}
