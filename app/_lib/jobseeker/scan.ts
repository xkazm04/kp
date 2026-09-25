// The scan: acquire → structure → match → deep-dive, for ONE workspace. Two callers share
// it and own what happens around it — the `jobseeker_scan` task kind (tasks.ts, the manual
// "scan now" door) and the clock job (instrumentation-node.ts, fan-out over every
// workspace with a profile and an enabled source). Both record the scheduler_runs row
// themselves; this module answers the ScanSummary (types.ts) and nothing else.
//
// Everything it touches is injected (ScanDeps) so scan.test.ts runs the whole pipeline
// over fixture adapters and a scripted Python runner with no network and no interpreter.
// The production binding (defaultScanDeps) is the stores, politeFetch, adapterFor and
// runPythonCli.
//
// Honesty rules the summary keeps:
//   - a source paused by reconcile (blocked / collapsed) stays paused; the scan moves on;
//   - the wall budget (8 min, shared with the caller's signal) stops BETWEEN sources and
//     between phases, never mid-source — a half-reconciled source would mark absent what
//     it never reached; sources not reached are recorded `skipped` with reason
//     `wall_budget`, not omitted;
//   - `matched` counts rows the matcher scored this run; KO'd postings are not scored 0,
//     they are stored with their gate and as-if score (match_total NULL) and stamped, so
//     the next unchanged scan skips them too; `skippedUpToDate` counts the rows
//     whose stored match was still the truth, so a re-scan that changed nothing says "0
//     scored, N already current" instead of quietly re-spending on the whole dataset;
//   - the deep-dive stops at the FIRST keyless / deterministic answer, `deepDiveSkipped:
//     "no_provider"` — one cheap spawn per scan without a key, never maxPerScan of them.

import {
  listDeepDiveCandidates,
  listPostingsForMatching,
  listPostingsNeedingStructure,
  markAbsent,
  setPostingBlocked,
  setPostingMatch,
  setPostingStructure,
  upsertPosting,
} from "../db/jobseeker-postings";
import { getWorkspaceJobseekerProfile } from "../db/jobseeker-profiles";
import { listJobseekerSources, pauseSource, recordSourceRun } from "../db/jobseeker-sources";
import { adapterFor } from "./adapters/registry";
import type { AdapterLimits, AdapterLogEvent, SourceAdapter } from "./adapters/types";
import { deepDivePosting, type DeepDiveOutcome } from "./deepdive";
import type { HostLookup } from "../ats-egress-guard";
import { egressGuardedFetch } from "./fetch/egress";
import { politeFetch, type PoliteFetch } from "./fetch/politeFetch";
import { matchPostings, MATCH_VERSION, type StructuredPosting } from "./match";
import { runPythonCli, type CliRunner } from "./python-cli";
import { reconcileSource } from "./reconcile";
import type { JobseekerPosting, JobseekerProfile, JobseekerSource, ScanSummary, SourceAdapterName, SourceRunSummary } from "./types";

/** Per source per run. Tighter than DEFAULT_ADAPTER_LIMITS on refs: a twice-daily scan
 *  over several boards is a courtesy budget. There is no cursor — the next run starts
 *  from the top again — so a source that reaches either cap is a TRUNCATED pass and
 *  reconcile marks nothing absent on it (a posting past the cap is unseen, not gone). */
export const SCAN_LIMITS: AdapterLimits = { maxRefs: 300, maxDetailFetches: 60 };
/** The whole scan — acquisition, structuring, matching, deep-dive — for one workspace. */
export const SCAN_WALL_BUDGET_MS = 8 * 60_000;
/** posting_structure_cli batch size: one spawn per chunk. */
export const STRUCTURE_CHUNK = 200;
/** A source the wall budget did not reach: recorded, never omitted. */
export const SCAN_SKIP_REASON = "wall_budget";

export type ScanTrigger = ScanSummary["trigger"];
export type ScanProgress = (done: number, total: number, msg?: string) => void;

export type ScanDeps = {
  now: () => string;
  getProfile: (workspaceId: string) => JobseekerProfile | null;
  listSources: (workspaceId: string) => JobseekerSource[];
  adapterFor: (name: SourceAdapterName) => SourceAdapter;
  /** The transport. The scan wraps it in the egress guard (fetch/egress.ts) itself, so
   *  a sitemap <loc>, a rule-extracted detail URL or a redirect a board controls never
   *  reaches a private address, whatever transport is bound. */
  fetch: PoliteFetch;
  /** DNS for that guard; unset = the system resolver. */
  lookup?: HostLookup;
  upsertPosting: typeof upsertPosting;
  markAbsent: typeof markAbsent;
  recordSourceRun: typeof recordSourceRun;
  pauseSource: typeof pauseSource;
  listPostingsNeedingStructure: typeof listPostingsNeedingStructure;
  setPostingStructure: typeof setPostingStructure;
  listPostingsForMatching: typeof listPostingsForMatching;
  setPostingMatch: typeof setPostingMatch;
  setPostingBlocked: typeof setPostingBlocked;
  listDeepDiveCandidates: typeof listDeepDiveCandidates;
  deepDive: (posting: JobseekerPosting, profile: JobseekerProfile, opts: { signal?: AbortSignal; workspaceId: string }) => Promise<DeepDiveOutcome>;
  runCli: CliRunner;
  log: (event: AdapterLogEvent & { sourceId?: string }, error?: unknown) => void;
};

export const defaultScanDeps: ScanDeps = {
  now: () => new Date().toISOString(),
  getProfile: getWorkspaceJobseekerProfile,
  listSources: listJobseekerSources,
  adapterFor,
  fetch: politeFetch,
  upsertPosting,
  markAbsent,
  recordSourceRun,
  pauseSource,
  listPostingsNeedingStructure,
  setPostingStructure,
  listPostingsForMatching,
  setPostingMatch,
  setPostingBlocked,
  listDeepDiveCandidates,
  deepDive: (posting, profile, opts) => deepDivePosting(posting, profile, opts),
  runCli: runPythonCli,
  log: (event, error) => {
    const line = `[jobseeker:scan] ${event.sourceId ? `${event.sourceId} ` : ""}${event.code}${event.detail ? ` — ${event.detail}` : ""}`;
    if (error !== undefined) console.error(line, error);
    else if (event.level === "warn") console.warn(line);
    else console.log(line);
  },
};

export type ScanOptions = {
  trigger: ScanTrigger;
  signal?: AbortSignal;
  onProgress?: ScanProgress;
  deps?: Partial<ScanDeps>;
};

/** The caller's signal joined with this scan's own wall budget. */
function budgetSignal(outer: AbortSignal | undefined): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("jobseeker scan: wall budget exhausted")), SCAN_WALL_BUDGET_MS);
  const onOuter = () => controller.abort(outer?.reason);
  if (outer?.aborted) onOuter();
  else outer?.addEventListener("abort", onOuter, { once: true });
  return {
    signal: controller.signal,
    release: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    },
  };
}

function skippedSummary(sourceId: string): SourceRunSummary {
  return { sourceId, outcome: "skipped", new: 0, changed: 0, unchanged: 0, absent: 0, reason: SCAN_SKIP_REASON };
}

export async function runJobseekerScan(workspaceId: string, opts: ScanOptions): Promise<ScanSummary> {
  const deps: ScanDeps = { ...defaultScanDeps, ...opts.deps };
  const startedAt = deps.now();
  const summary: ScanSummary = {
    workspaceId,
    trigger: opts.trigger,
    startedAt,
    finishedAt: startedAt,
    sources: [],
    matched: 0,
    skippedUpToDate: 0,
    deepDived: 0,
    deepDiveSkipped: null,
  };
  const finish = (): ScanSummary => ({ ...summary, finishedAt: deps.now() });
  const progress: ScanProgress = opts.onProgress ?? (() => undefined);

  // The INPUTS time: taken before the profile is read, and the stamp every match of this
  // scan carries. A match is "current" when matchedAt >= the profile's updatedAt; stamped
  // with the time the scoring FINISHED, a preferences edit saved mid-scan (after the read,
  // before the stamp) would read as already applied and never be re-matched.
  const inputsAt = startedAt;
  const profile = deps.getProfile(workspaceId);
  if (!profile) {
    // Nothing to match against: no acquisition either — a dataset nobody can read is
    // spend (ours and the boards') with no reader.
    summary.deepDiveSkipped = "no_profile";
    progress(0, 0, "no_profile");
    return finish();
  }

  const sources = deps.listSources(workspaceId).filter((s) => s.enabled && s.pausedReason === null);
  const guardedFetch = egressGuardedFetch(deps.fetch, deps.lookup);
  // Progress steps: one per source, then structure, match, deep-dive.
  const total = sources.length + 3;
  let done = 0;
  const { signal, release } = budgetSignal(opts.signal);
  try {
    // ── 1. Acquire ─────────────────────────────────────────────────────────────
    for (const source of sources) {
      if (signal.aborted) {
        summary.sources.push(skippedSummary(source.id));
        continue;
      }
      progress(done, total, source.host);
      const run = await reconcileSource(
        source,
        deps.adapterFor(source.adapter),
        {
          source,
          preferences: profile.preferences,
          fetch: guardedFetch,
          limits: SCAN_LIMITS,
          log: (event) => deps.log({ ...event, sourceId: source.id }),
        },
        {
          upsertPosting: (sourceId, raw, seenAt) => deps.upsertPosting(sourceId, raw, seenAt, workspaceId),
          markAbsent: (sourceId, seenBefore) => deps.markAbsent(sourceId, seenBefore, workspaceId),
          recordSourceRun: (sourceId, outcome, at) => deps.recordSourceRun(sourceId, outcome, at, workspaceId),
          pauseSource: (sourceId, reason) => deps.pauseSource(sourceId, reason, workspaceId),
          now: deps.now,
        }
      );
      summary.sources.push(run);
      done += 1;
    }

    // ── 2. Structure (deterministic, one spawn per 200) ─────────────────────────
    progress(done, total, "structure");
    if (!signal.aborted) {
      const pending = deps.listPostingsNeedingStructure(workspaceId);
      for (let i = 0; i < pending.length && !signal.aborted; i += STRUCTURE_CHUNK) {
        const chunk = pending.slice(i, i + STRUCTURE_CHUNK);
        try {
          const out = await deps.runCli({
            module: "posting_structure_cli",
            files: { "input.json": chunk },
            args: (f) => ["--input-json", f["input.json"]],
            signal,
          });
          const jobs = Array.isArray(out.jobs) ? (out.jobs as { id?: unknown; job?: unknown }[]) : [];
          for (const row of jobs) {
            if (typeof row.id === "string" && row.job && typeof row.job === "object") {
              deps.setPostingStructure(row.id, row.job as Record<string, unknown>, "deterministic", workspaceId);
            }
          }
          const notes = Array.isArray(out.notes) ? out.notes.length : 0;
          if (notes) deps.log({ level: "info", code: "structure_notes", detail: `${notes} note(s) over ${chunk.length} posting(s)` });
        } catch (error) {
          deps.log({ level: "warn", code: "structure_failed", detail: `chunk ${i / STRUCTURE_CHUNK}` }, error);
        }
      }
    }
    done += 1;

    // ── 3. Match (deterministic, one spawn per 500) ────────────────────────────
    progress(done, total, "match");
    if (!signal.aborted) {
      // INCREMENTAL: a row whose match carries this MATCH_VERSION and was written after
      // the profile last moved is already the truth — the store skips it and says how
      // many. Everything else comes back: never matched, nulled by a content change
      // (upsertPosting), scored under an older version, or scored before the seeker
      // changed their preferences.
      const pending = deps.listPostingsForMatching(workspaceId, {
        upToDateVersion: MATCH_VERSION,
        profileUpdatedAt: profile.updatedAt,
      });
      const structured: StructuredPosting[] = pending.rows;
      summary.skippedUpToDate = pending.skippedUpToDate;
      const outcome = await matchPostings(profile, structured, {
        runCli: deps.runCli,
        signal,
        onChunkError: (error, chunk) => deps.log({ level: "warn", code: "match_failed", detail: `chunk ${chunk}` }, error),
      });
      const matchedAt = inputsAt;
      for (const m of outcome.matched) {
        deps.setPostingMatch(m.id, m.match, { total: m.total, fitTier: m.fitTier, version: MATCH_VERSION, matchedAt }, workspaceId);
      }
      // The filtered tail: stored once with the gate and the as-if score (never a
      // total), stamped so the next unchanged scan skips it. setPostingBlocked re-checks
      // job_json, so a posting whose content moved since the list is left to re-match.
      for (const b of outcome.blocked) {
        deps.setPostingBlocked(b.id, { blocked: { koKeys: b.koKeys, koDetails: b.koDetails }, asIf: b.match }, { version: MATCH_VERSION, matchedAt }, workspaceId);
      }
      summary.matched = outcome.matched.length;
      if (outcome.koFiltered) {
        deps.log({ level: "info", code: "ko_filtered", detail: `${outcome.koFiltered} posting(s) failed the hard filter: ${JSON.stringify(outcome.koReasons)}` });
      }
    }
    done += 1;

    // ── 4. Deep-dive (model; bounded by the seeker's policy; stops at the first
    //      keyless answer) ───────────────────────────────────────────────────────
    progress(done, total, "deep-dive");
    if (!signal.aborted) {
      const policy = profile.preferences.deepDive;
      const shortlist = deps.listDeepDiveCandidates({ threshold: policy.threshold, limit: policy.maxPerScan }, workspaceId);
      for (const posting of shortlist) {
        if (signal.aborted) break;
        try {
          const result = await deps.deepDive(posting, profile, { signal, workspaceId });
          if (result.kind === "done") {
            summary.deepDived += 1;
            continue;
          }
          summary.deepDiveSkipped = "no_provider";
          break;
        } catch (error) {
          // An engine fault on one posting is not a verdict on the provider: log it and
          // let the next shortlisted posting try. The loop is bounded by maxPerScan.
          deps.log({ level: "warn", code: "deepdive_failed", detail: posting.id }, error);
        }
      }
    }
    done += 1;
    progress(done, total, signal.aborted ? "aborted" : "done");
    return finish();
  } finally {
    release();
  }
}
