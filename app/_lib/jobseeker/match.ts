// Score the seeker's profile against the structured postings — ONE match_cli spawn per
// chunk of up to 500 jobs, no model call. The recruiter side ranks a candidate against a
// corpus; here the "corpus" is the seeker's own reconciled dataset, so the committed seed
// corpus is replaced by an EMPTY `--jobs` file and the postings ride in as `--jobs-json`
// (the poison-pill-isolated path: one malformed job is skipped on stderr, the rest score).
//
// KO'd postings come back per id because the seeker scan asks with `--include-blocked`:
// each carries the gates that removed it and the MatchResult scored AS IF they were
// lifted. The scan stores that verdict with match_total NULL — a posting that failed the
// hard filter is not "0 % fit", it is "not comparable", and the feed must not sort it as
// a bad match — and stamps it, so an unchanged re-scan does not send it again.

import { FIT_PROMISING_FLOOR, FIT_STRONG_FLOOR } from "../fit-thresholds";
import type { CliRunner } from "./python-cli";
import { isKoReasonKey, type FitTier, type JobseekerProfile, type KoReasonKey } from "./types";

/** Stamped on every row this module writes (`match_version`); bump when the inputs the
 *  matcher sees change shape (preferences overlay, corpus hand-off). v2: KO'd postings
 *  are stamped with their gate verdict, so every v1 row is re-matched once to gain it. */
export const MATCH_VERSION = "jobseeker-match-v2";
/** match_cli's `--limit` is also our chunk: every job in a chunk can come back. */
export const MATCH_CHUNK = 500;

export type StructuredPosting = { id: string; job: Record<string, unknown> };

export type MatchedPosting = {
  id: string;
  /** The MatchResult verbatim (pipeline schema, camelCase). */
  match: Record<string, unknown>;
  total: number;
  fitTier: FitTier;
};

/** A posting the KO filter removed: the gates (filtered to the known vocabulary, each with
 *  its clause) and the as-if MatchResult verbatim. Never a rank — no total column. */
export type BlockedPosting = {
  id: string;
  match: Record<string, unknown>;
  koKeys: KoReasonKey[];
  koDetails: string[];
};

export type MatchOutcome = {
  matched: MatchedPosting[];
  /** The KO'd postings of the chunk with their verdict, for the store to stamp. */
  blocked: BlockedPosting[];
  /** Postings the KO filter dropped — unmatched, counted, never scored 0. */
  koFiltered: number;
  /** The matcher's aggregated blockers (`meta.koReasons`), for the scan log. */
  koReasons: unknown;
};

function fitTierFor(total: number, stated: unknown): FitTier {
  if (stated === "strong" || stated === "promising" || stated === "partial") return stated;
  return total >= FIT_STRONG_FLOOR ? "strong" : total >= FIT_PROMISING_FLOOR ? "promising" : "partial";
}

/** The matcher's `blocked` array → the verdicts this chunk can stamp. An id outside the
 *  chunk, an entry with no readable as-if result, or one whose gates are all outside the
 *  KoReasonKey vocabulary is dropped: that posting stays unstamped and is re-matched. */
function readBlocked(raw: unknown, byId: Set<string>): BlockedPosting[] {
  if (!Array.isArray(raw)) return [];
  const out: BlockedPosting[] = [];
  for (const entry of raw as Record<string, unknown>[]) {
    if (!entry || typeof entry !== "object") continue;
    const id = typeof entry.jobId === "string" ? entry.jobId : null;
    const result = entry.result && typeof entry.result === "object" && !Array.isArray(entry.result) ? (entry.result as Record<string, unknown>) : null;
    if (!id || !byId.has(id) || !result) continue;
    const keys = Array.isArray(entry.koKeys) ? entry.koKeys : [];
    const details = Array.isArray(entry.koDetails) ? entry.koDetails : [];
    const koKeys: KoReasonKey[] = [];
    const koDetails: string[] = [];
    keys.forEach((k, i) => {
      if (!isKoReasonKey(k)) return;
      koKeys.push(k);
      koDetails.push(typeof details[i] === "string" ? (details[i] as string) : "");
    });
    if (koKeys.length === 0) continue;
    out.push({ id, match: result, koKeys, koDetails });
  }
  return out;
}

/** One chunk → the rows the matcher returned. Exported for deepdive.ts's single-posting
 *  re-match, which is this call with one job. */
export async function matchChunk(
  profile: JobseekerProfile,
  postings: StructuredPosting[],
  runCli: CliRunner,
  signal?: AbortSignal
): Promise<MatchOutcome> {
  if (postings.length === 0) return { matched: [], blocked: [], koFiltered: 0, koReasons: null };
  const byId = new Set(postings.map((p) => p.id));
  const out = await runCli({
    module: "match_cli",
    files: {
      "profile.json": profile.profile,
      "preferences.json": profile.preferences,
      // Empty corpus: the seeker's dataset is the whole ranking universe.
      "corpus.json": [],
      // The id is forced onto the job so a result can be joined back to its row.
      "jobs.json": postings.map((p) => ({ ...p.job, id: p.id })),
    },
    args: (f) => [
      "--profile-json", f["profile.json"],
      "--preferences-json", f["preferences.json"],
      "--jobs", f["corpus.json"],
      "--jobs-json", f["jobs.json"],
      "--limit", String(postings.length),
      "--include-blocked",
    ],
    signal,
  });
  const matches = Array.isArray(out.matches) ? (out.matches as Record<string, unknown>[]) : [];
  const matched: MatchedPosting[] = [];
  for (const m of matches) {
    const id = typeof m.jobId === "string" ? m.jobId : typeof m.job_id === "string" ? m.job_id : null;
    const total = typeof m.total === "number" && Number.isFinite(m.total) ? m.total : null;
    if (!id || total === null || !byId.has(id)) continue;
    matched.push({ id, match: m, total, fitTier: fitTierFor(total, m.fitTier ?? m.fit_tier) });
  }
  const meta = out.meta && typeof out.meta === "object" ? (out.meta as Record<string, unknown>) : {};
  const koFiltered = typeof meta.koFiltered === "number" ? meta.koFiltered : Math.max(0, postings.length - matched.length);
  return { matched, blocked: readBlocked(out.blocked, byId), koFiltered, koReasons: meta.koReasons ?? null };
}

/** The whole dataset, chunked. A chunk that fails (engine error, abort) is logged by the
 *  caller and the other chunks still land — the scan is a sweep, not a transaction. */
export async function matchPostings(
  profile: JobseekerProfile,
  postings: StructuredPosting[],
  deps: { runCli: CliRunner; signal?: AbortSignal; onChunkError?: (error: unknown, chunk: number) => void }
): Promise<MatchOutcome> {
  const all: MatchOutcome = { matched: [], blocked: [], koFiltered: 0, koReasons: null };
  for (let i = 0; i < postings.length; i += MATCH_CHUNK) {
    if (deps.signal?.aborted) break;
    try {
      const part = await matchChunk(profile, postings.slice(i, i + MATCH_CHUNK), deps.runCli, deps.signal);
      all.matched.push(...part.matched);
      all.blocked.push(...part.blocked);
      all.koFiltered += part.koFiltered;
      all.koReasons ??= part.koReasons;
    } catch (error) {
      deps.onChunkError?.(error, i / MATCH_CHUNK);
    }
  }
  return all;
}
