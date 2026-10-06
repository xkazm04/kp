// THE SEED-ORIGIN PROOF for the goal-1 demo's simulated interview (finding 2b of
// docs/security/role-demo-sim-scan-2026-10-06.md, closed on the operator's answer of
// 2026-10-06: "seeded entries only").
//
// WHAT IT IS FOR. The demo run plays whichever branches its stand-in approved on a COPY of
// whatever database the operator pointed it at, and for each one it renders the entry's
// whole CV profile and the entry's private interviewer brief into the system prompt of a
// `claude -p` call. On a real install those are real people, chosen by the policy and not
// by any demo fixture. So an entry is played ONLY when the code can PROVE it is seed data,
// and anything unproven is refused with a recorded reason. Fail-closed: if the seed files
// are missing or unreadable, EVERY entry is refused — there is no fallback to playing them,
// because "I could not check" and "it is fine" are not the same sentence.
//
// WHAT COUNTS AS PROOF. The live row has to match the fixtures the seeders load:
//   - data/seed_pipeline/pipeline.json has a record with this entry's id, and that record
//     gives the same candidate_id and candidate_label the live row carries (seedPipeline,
//     app/_lib/db/core.ts, including its `?? "Candidate"` default for a label-less record);
//   - data/seed_candidates/candidates.json has a record under that candidate id, and the
//     candidate's stored CV payload is EQUAL to it — in the form seedCandidates stores,
//     which is the record verbatim (`payload_json = JSON.stringify(rec)`), so the
//     comparison is a canonical-JSON equality and nothing is normalized away.
// The job the entry sits on is deliberately NOT part of the proof: moving a seeded
// candidate onto another job is ordinary board state and changes nothing about whose CV
// this is. Identity and CV content are the whole question.
//
// TWO WEAKER SIGNALS, BOTH REJECTED — each was considered and each would have been false
// assurance, which on this path is worse than none:
//   - THE seed_marks ROWS. `adoptedExistingSeed` stamps the "pipeline" mark on a database
//     that merely had pipeline rows already (core.ts, seedPipeline's second line), so a
//     real install's board carries the mark of a seeding that never happened. A mark says
//     "this seeder will not run again", never "these rows came from the fixture".
//   - THE ID SHAPE (`pe-011`, `cand-011`). seedPipeline inserts with INSERT OR IGNORE and
//     the ids are a plain committed vocabulary, so a row a human, an import or an ATS
//     mirror created can hold `pe-011` and keep its own candidate. A naming convention is
//     not provenance.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The two fixture files, relative to a repository root. Same paths the seeders read. */
export const SEED_PIPELINE_RELPATH = path.join("data", "seed_pipeline", "pipeline.json");
export const SEED_CANDIDATES_RELPATH = path.join("data", "seed_candidates", "candidates.json");

/** What seedPipeline writes when a seed record names no label. */
const SEED_LABEL_FALLBACK = "Candidate";

/** The fixtures, indexed: entry id → the identity the seed gives it, candidate id → the
 *  canonical form of the CV record the candidates seeder stores for it. */
export type SeedCorpus = {
  entries: Map<string, { candidateId: string; candidateLabel: string }>;
  candidates: Map<string, string>;
};

/** Key-sorted JSON, recursively: two payloads that differ only in key order are the same
 *  record. `undefined` (which JSON.stringify drops) is written as null, so a key holding it
 *  cannot silently vanish from one side of the comparison. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The roots a fixture file is looked for under: the process's own directory first (what the
 *  seeders use), then the repository this module was loaded from — so a demo child started
 *  from elsewhere still finds the committed fixtures instead of refusing everything. */
function seedRoots(): string[] {
  const fromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const roots = [process.cwd(), fromModule];
  return roots.filter((r, i) => r && roots.indexOf(r) === i);
}

function readSeedArray(relPath: string): Array<Record<string, unknown>> | null {
  for (const root of seedRoots()) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(root, relPath), "utf8"));
      if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
    } catch {
      /* unreadable or absent under this root: try the next one, and refuse if none works */
    }
  }
  return null;
}

let cached: SeedCorpus | null | undefined;

/** The indexed fixtures, or null when either file is missing or unreadable. Memoized per
 *  process (the files are committed and do not change under a run); `forget` is for the
 *  fixtures that exercise the unreadable case. */
export function loadSeedCorpus(): SeedCorpus | null {
  if (cached !== undefined) return cached;
  const pipeline = readSeedArray(SEED_PIPELINE_RELPATH);
  const candidates = readSeedArray(SEED_CANDIDATES_RELPATH);
  if (!pipeline || !candidates) {
    cached = null;
    return cached;
  }
  const entries = new Map<string, { candidateId: string; candidateLabel: string }>();
  for (const rec of pipeline) {
    const id = typeof rec.id === "string" ? rec.id : "";
    const candidateId = typeof rec.candidateId === "string" ? rec.candidateId : "";
    if (!id || !candidateId) continue;
    entries.set(id, {
      candidateId,
      candidateLabel: typeof rec.candidateLabel === "string" && rec.candidateLabel ? rec.candidateLabel : SEED_LABEL_FALLBACK,
    });
  }
  const byId = new Map<string, string>();
  for (const rec of candidates) {
    const id = typeof rec.id === "string" ? rec.id : "";
    if (!id) continue;
    byId.set(id, canonicalJson(rec));
  }
  cached = { entries, candidates: byId };
  return cached;
}

/** Drop the memo (tests only). */
export function forgetSeedCorpus(): void {
  cached = undefined;
}

/** The live row the proof is about. `profileId` is the profile actually read, so a lookup
 *  that returned somebody else's record cannot pass as the entry's candidate. */
export type SeedOriginSubject = {
  entryId: string;
  candidateId: string | null;
  candidateLabel: string | null;
  profileId: string;
  profilePayload: unknown;
};

/**
 * Why this entry is NOT provably seed data, or null when it is.
 *
 * The returned reason is printed to the operator and rides the `--json` reading, so it names
 * which check failed and NEVER any CV content, label or id from the live row.
 */
export function seedOriginProblem(subject: SeedOriginSubject, corpus: SeedCorpus | null = loadSeedCorpus()): string | null {
  if (!corpus) return `the seed fixtures could not be read (${SEED_PIPELINE_RELPATH}, ${SEED_CANDIDATES_RELPATH})`;
  const seeded = corpus.entries.get(subject.entryId);
  if (!seeded) return "the pipeline seed holds no entry with this id";
  if (!subject.candidateId || subject.candidateId !== seeded.candidateId) return "the entry's candidate is not the candidate the pipeline seed gives this entry";
  if (subject.profileId !== subject.candidateId) return "the CV profile read is not the entry's own candidate";
  if ((subject.candidateLabel ?? "") !== seeded.candidateLabel) return "the entry's candidate label is not the label the pipeline seed gives this entry";
  const seededCv = corpus.candidates.get(subject.candidateId);
  if (seededCv === undefined) return "the candidate seed holds no CV record for this candidate";
  if (canonicalJson(subject.profilePayload) !== seededCv) return "the stored CV profile is not the candidate seed's record for it (edited, rebuilt, erased or replaced)";
  return null;
}
