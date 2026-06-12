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
  /** PREP2 — only folded into the key for the `prep` task: the narrative locale,
   *  so a cached English prep pack never serves a cs session (and vice versa).
   *  Absent/undefined for every other task and for legacy callers. */
  lang?: string;
  /** GH7 — only folded into the key for the GITHUB_EVIDENCE_TASKS
   *  (screen/prep/scorecard): EXACTLY the serialized evidence bytes handed to
   *  Python as github.json, hashed. Those prompts now render the evidence, so a
   *  refreshed deep-dive must invalidate the 168h cache — and evidence appearing
   *  on a previously bare entry must too (the absent case keys as ""). Absent
   *  for every other task and for evidence-less entries. */
  githubEvidenceJson?: string;
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
      input.task === "prep" ? input.lang ?? "en" : "",
      // GH7 — evidence axis for the prompts that render it; "" for a bare entry
      // so attaching evidence later genuinely re-keys.
      GITHUB_EVIDENCE_TASKS.has(input.task) && input.githubEvidenceJson ? shortHash(input.githubEvidenceJson) : "",
    ].join("|")
  );
}
