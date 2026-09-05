import { createHash } from "node:crypto";

// Pure, dependency-free derivation of the automation prompt-cache key. Split out
// of automation-run.ts (mirroring cache-key.ts) so the keying contract — above
// all, that a changed candidate profile yields a changed key — can be exercised
// directly by Node's built-in test runner. See automation-cache-key.test.ts.

const shortHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

// GH7 — the tasks whose prompts render the entry's compact GitHub evidence
// summary (the candidate-assessment prompts). outreach/rejection/offer draft
// messages and rematch ranks the corpus — none of them read the evidence, so
// it must not split their keys. Exported so automation-run.ts gates the
// github.json hand-off on the SAME set that scopes the key: the cache axis and
// the prompt input can never drift apart.
export const GITHUB_EVIDENCE_TASKS: ReadonlySet<string> = new Set(["screen", "prep", "scorecard"]);

// Backlog #34 — the tasks whose output LANGUAGE is an input axis. There are two
// language AUTHORITIES, so the sets are declared separately (automation-run pushes
// a different --lang for each), but the cache key reads their UNION: every task
// that receives a --lang must key on it, or a locale switch serves the previous
// language's output for up to the 168h TTL.
//
// LETTER: candidate-facing letters render in the entry's RESOLVED comms locale.
export const LETTER_LANG_TASKS: ReadonlySet<string> = new Set(["outreach", "rejection", "offer"]);
// UI: recruiter-facing narrative (screening rationale, interview prep, scorecard
// summary — all surfaced in Decisions) renders in the recruiter's UI locale.
// screen/scorecard were receiving --lang WITHOUT keying on it: a locale switch
// served the old language's screening rationale / scorecard summary for the full
// TTL. Their AUTOMATION_VERSIONs are bumped (screening-v2 / scorecard-v6) so the
// pre-fix, wrongly-shared entries self-invalidate.
// rematch joined 2026-09-05. Its verdict sentence is recruiter-facing narrative like
// the other three, and automation.py now forwards --lang to generate_reasoning and
// stamps narrativeLang — but the engine only receives a locale for tasks in one of
// these two sets, so without this entry the fix could not reach the app path and the
// rationale stayed English on every install. Adding it also makes the locale a key
// axis, so the wrongly-shared English entries self-invalidate.
export const UI_LANG_TASKS: ReadonlySet<string> = new Set(["prep", "screen", "scorecard", "rematch"]);
// THE one lang-task union — consumed by the key below AND (via the two sets above)
// by automation-run's --lang gating, mirroring the GITHUB_EVIDENCE_TASKS pattern:
// the cache axis and the prompt input can never drift apart.
export const LANG_KEYED_TASKS: ReadonlySet<string> = new Set([...LETTER_LANG_TASKS, ...UI_LANG_TASKS]);

export type AutomationKeyInput = {
  /** AUTOMATION_VERSION[task] — bumps retire prior cache entries. */
  version: string;
  /** screen | outreach | rejection | prep | scorecard | rematch | offer. */
  task: string;
  candidateId: string;
  /** EXACTLY the bytes handed to Python (JSON.stringify(rec.payload)). Hashing the
   *  serialized profile is what makes the key track the model's actual input. */
  profileJson: string;
  jobId: string | null;
  /** Only folded into the key for the `rejection` task (it varies the prompt). */
  stage: string;
  /** Only folded into the key for the `scorecard` task (free-text interviewer notes). */
  notes: string;
  /** Only folded into the key for the `rematch` task: a fingerprint of the live job
   *  corpus (see computeCorpusFingerprint). rematch scores the ENTIRE corpus, which
   *  lives OUTSIDE the (version|candidate|currentJob) tuple, so without this a cached
   *  rematch could route to a since-closed role — or miss a newly-opened one — for the
   *  full 168h TTL. Absent for every other task. */
  corpusFingerprint?: string;
  /** Folded into the key for the LANG_KEYED_TASKS: the recruiter-narrative locale
   *  (prep/screen/scorecard — PREP2) and the letter tasks' resolved candidate-comms
   *  locale (backlog #34), so a cached draft in one language never serves the
   *  other. Absent/undefined for every other task and for legacy callers. */
  lang?: string;
  /** DEGRADED axis: true when the run spends the deterministic-template path
   *  (`--no-llm`, pushed past the ai_candidates allowance) instead of the model.
   *  The two produce materially different output under ONE key otherwise: a
   *  quota-exhausted workspace's stubs kept serving for the full 168h TTL after
   *  the allowance reset, and a quota exhaustion re-served a stale LLM result as
   *  if it were the degraded template. `payload.source` recorded which — the key
   *  did not. Folded UNCONDITIONALLY (not only when true) so entries cached
   *  BEFORE this axis existed — the ones that may already be poisoned — are
   *  retired on deploy rather than lingering for a week. */
  degraded?: boolean;
  /** GH7 — only folded into the key for the GITHUB_EVIDENCE_TASKS
   *  (screen/prep/scorecard): EXACTLY the serialized evidence bytes handed to
   *  Python as github.json, hashed. Those prompts now render the evidence, so a
   *  refreshed deep-dive must invalidate the 168h cache — and evidence appearing
   *  on a previously bare entry must too (the absent case keys as ""). Absent
   *  for every other task and for evidence-less entries. */
  githubEvidenceJson?: string;
  /** Only folded into the key for the SCORECARD_TASKS (rejection/offer — the two
   *  letters drafted after an interview): EXACTLY the serialized scorecard bytes
   *  handed to Python as scorecard.json, hashed. Same shape and same reason as the
   *  GH7 axis above: those prompts now ground themselves in the interview, so a
   *  scorecard synthesized (or re-synthesized) AFTER a first draft must invalidate
   *  the 168h entry — nothing else in the key moves when it appears, and the letter
   *  it would keep serving is the ungrounded one. Absent for every other task and
   *  for entries with no interview (which keys as "", so attaching one re-keys). */
  scorecardJson?: string;
};

// Stable fingerprint of the live job corpus for the rematch cache key: the SORTED
// job ids hashed to a compact token. Sorting makes it order-independent, so the
// corpus query order can never split the key; any opening added to or removed from
// the corpus changes the set and therefore the token, so the rematch cache self-
// invalidates the moment current openings change (idea-e01935e9). Keeping it ids-only
// (not full job content) matches the requirement's "sorted job ids" contract and
// keeps churn to genuine openings turnover, not incidental field edits.
export function computeCorpusFingerprint(jobIds: string[]): string {
  return shortHash([...jobIds].sort().join(","));
}

// The automation cache has a 168h TTL, so a stale key serves byte-identical output
// for up to 7 days. The candidate PROFILE is the model's primary input, yet the key
// historically omitted it entirely — (version|candidateId|jobId|stage?|notes?) — so a
// re-extracted or edited CV left the key unchanged and "Regenerate" returned stale
// questions while the modal claimed a refresh (idea-8dcf7828). Folding a content hash
// of the exact profile bytes sent to Python closes that silent-staleness gap: any
// profile edit changes the key, so the next run genuinely recomputes. candidateId is
// kept alongside the profile hash so the key still scopes to the entry's candidate.
//
// An unchanged profile (byte-identical serialization) deliberately keeps the same key
// — that's a correct cache HIT (same input → same output), not the staleness bug.
export function computeAutomationCacheKey(input: AutomationKeyInput): string {
  const profileHash = shortHash(input.profileJson);
  return shortHash(
    [
      input.version,
      input.candidateId,
      profileHash,
      input.jobId ?? "",
      input.task === "rejection" ? input.stage : "",
      input.task === "scorecard" ? shortHash(input.notes) : "",
      input.task === "rematch" ? input.corpusFingerprint ?? "" : "",
      LANG_KEYED_TASKS.has(input.task) ? input.lang ?? "en" : "",
      // GH7 — evidence axis for the prompts that render it; "" for a bare entry
      // so attaching evidence later genuinely re-keys.
      GITHUB_EVIDENCE_TASKS.has(input.task) && input.githubEvidenceJson ? shortHash(input.githubEvidenceJson) : "",
      // The interview the rejection/offer letter is grounded in; "" for an entry
      // with no interview, so a later synthesis genuinely re-keys. Gated on the
      // VALUE rather than a task set: automation-run passes it only for the tasks
      // whose prompt reads it, and one authority for that is enough.
      input.scorecardJson ? shortHash(input.scorecardJson) : "",
      // Degraded (template) vs LLM output never share a key — see `degraded` above.
      input.degraded ? "no-llm" : "llm",
    ].join("|")
  );
}
