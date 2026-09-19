// Score the seeker's profile against the structured postings — ONE match_cli spawn per
// chunk of up to 500 jobs, no model call. The recruiter side ranks a candidate against a
// corpus; here the "corpus" is the seeker's own reconciled dataset, so the committed seed
// corpus is replaced by an EMPTY `--jobs` file and the postings ride in as `--jobs-json`
// (the poison-pill-isolated path: one malformed job is skipped on stderr, the rest score).
//
// KO'd postings are not returned per id by the matcher (only `meta.koFiltered` and the
// aggregated `meta.koReasons`), so they stay unmatched (match_total NULL) and the scan
// reports the count — a posting that failed the hard filter is not "0 % fit", it is
// "not comparable", and the feed must not sort it as a bad match.

import { FIT_PROMISING_FLOOR, FIT_STRONG_FLOOR } from "../fit-thresholds";
import type { CliRunner } from "./python-cli";
import type { FitTier, JobseekerProfile } from "./types";

/** Stamped on every row this module writes (`match_version`); bump when the inputs the
 *  matcher sees change shape (preferences overlay, corpus hand-off). */
export const MATCH_VERSION = "jobseeker-match-v1";
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

export type MatchOutcome = {
  matched: MatchedPosting[];
  /** Postings the KO filter dropped — unmatched, counted, never scored 0. */
  koFiltered: number;
  /** The matcher's aggregated blockers (`meta.koReasons`), for the scan log. */
  koReasons: unknown;
};

function fitTierFor(total: number, stated: unknown): FitTier {
  if (stated === "strong" || stated === "promising" || stated === "partial") return stated;
  return total >= FIT_STRONG_FLOOR ? "strong" : total >= FIT_PROMISING_FLOOR ? "promising" : "partial";
}

/** One chunk → the rows the matcher returned. Exported for deepdive.ts's single-posting
 *  re-match, which is this call with one job. */
export async function matchChunk(
  profile: JobseekerProfile,
  postings: StructuredPosting[],
  runCli: CliRunner,
  signal?: AbortSignal
): Promise<MatchOutcome> {
  if (postings.length === 0) return { matched: [], koFiltered: 0, koReasons: null };
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
  return { matched, koFiltered, koReasons: meta.koReasons ?? null };
}

/** The whole dataset, chunked. A chunk that fails (engine error, abort) is logged by the
 *  caller and the other chunks still land — the scan is a sweep, not a transaction. */
export async function matchPostings(
  profile: JobseekerProfile,
  postings: StructuredPosting[],
  deps: { runCli: CliRunner; signal?: AbortSignal; onChunkError?: (error: unknown, chunk: number) => void }
): Promise<MatchOutcome> {
  const all: MatchOutcome = { matched: [], koFiltered: 0, koReasons: null };
  for (let i = 0; i < postings.length; i += MATCH_CHUNK) {
    if (deps.signal?.aborted) break;
    try {
      const part = await matchChunk(profile, postings.slice(i, i + MATCH_CHUNK), deps.runCli, deps.signal);
      all.matched.push(...part.matched);
      all.koFiltered += part.koFiltered;
      all.koReasons ??= part.koReasons;
    } catch (error) {
      deps.onChunkError?.(error, i / MATCH_CHUNK);
    }
  }
  return all;
}
