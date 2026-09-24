// The gig scan: for ONE workspace, every enabled, unpaused source runs
//   discover -> scanGigForHoneypots -> upsertGigFromRaw -> recordGigSourceRun
// and, when a qualifier is plugged in (deps.qualify - WP3's), every listing still `new`
// after the upsert is handed to it. Then, when a researcher is plugged in (deps.research,
// gigs/research.ts), up to GIG_RESEARCH_MAX_PER_SCAN gigs with no brief yet get one.
// Callers (the scheduler job, a "scan now" door) own the scheduler_runs row; this module
// answers GigScanSummary and nothing else.
//
// `opts.sourceId` narrows the run to ONE source (the Sources screen's per-source "scan
// now"): the same rules, the same summary, one source. A paused or disabled source is
// still not run - the door refuses it before enqueueing, and a pause that lands between
// the enqueue and the run is honoured here (`notRunnable: 1`, nothing fetched).
//
// Everything is injected (GigScanDeps; defaultGigScanDeps() is the production binding:
// the stores, politeFetch, gigAdapterFor, process.env) so scan.test.ts runs the whole
// thing over fixture adapters with no network and no key.
//
// Honesty rules the summary keeps (the job-seeker scan's, jobseeker/scan.ts):
//   - a denial pauses the source `blocked`, a changed provider shape pauses it
//     `collapsed`, a missing key pauses it `no_key`; a scan never un-pauses anything -
//     paused sources are not run at all, and the operator lifts the pause;
//   - the wall budget (8 min, joined with the caller's signal) stops BETWEEN sources,
//     never mid-source; a source not reached is recorded `skipped` with reason
//     `wall_budget` (or `aborted` when the caller cancelled), not omitted;
//   - a declined source (no key, no public API, manual) is `skipped` with its reason,
//     never a silent empty success; a provider that answered in an unknown shape is
//     `collapsed`, never "0 found";
//   - the summary carries CODES; a raw error goes to the server log only.

import { pauseGigSource, listGigSources, recordGigSourceRun } from "../db/gigs-sources";
import { upsertGigFromRaw } from "../db/gigs";
import { politeFetch, type PoliteFetch } from "../jobseeker/fetch/politeFetch";
import { gigAdapterFor } from "./adapters/registry";
import {
  AdapterCollapsed,
  DEFAULT_GIG_ADAPTER_LIMITS,
  FetchHalt,
  GigAdapterSkipped,
  type GigAdapter,
  type GigAdapterLimits,
  type GigAdapterLogEvent,
} from "./adapters/types";
import { scanGigForHoneypots } from "./suspect";
import type { Gig, GigAdapterName, GigPauseReason, GigSource, GigSourceRunOutcome } from "./types";

/** The whole scan for one workspace - acquisition plus the optional qualification. */
export const GIG_SCAN_WALL_BUDGET_MS = 8 * 60_000;

/** Every `reason` a source's run can carry: a code the UI translates, never a message. */
export const GIG_SCAN_REASONS = [
  "blocked", // a denial status or an interstitial on some fetch
  "offline", // KP_OFFLINE
  "shape_changed", // collapsed: the provider answered without what the adapter reads
  "required_rule_miss", // collapsed (the shared AdapterCollapsed vocabulary)
  "robots_disallowed", // the API host's robots.txt disallows the path
  "source_outage", // 5xx / timeout / network / too large
  "source_gone", // 404/410 on the list endpoint
  "no_key", // the adapter needs a key the environment does not hold
  "no_public_api", // the provider publishes no documented JSON API (algora)
  "manual_only", // a manual source is filled by the operator, never scanned
  "wall_budget", // the scan's 8-minute budget ran out before this source
  "aborted", // the caller cancelled before this source
  "store_error", // the gig store refused a write (logged server-side)
  "adapter_error", // an unexpected throw inside the adapter (logged server-side)
] as const;
export type GigScanReason = (typeof GIG_SCAN_REASONS)[number];

export type GigSourceRunSummary = {
  sourceId: string;
  adapter: GigAdapterName;
  outcome: GigSourceRunOutcome;
  reason: GigScanReason | null;
  /** The pause this run wrote (null = none). */
  paused: GigPauseReason | null;
  /** Listings the adapter yielded and the store accepted. */
  found: number;
  /** ...of which were new rows. */
  created: number;
  /** ...of which the honeypot scan flagged this run. */
  suspect: number;
};

export type GigScanSummary = {
  workspaceId: string;
  startedAt: string;
  finishedAt: string;
  sources: GigSourceRunSummary[];
  /** Sources not run because they are disabled or paused (the operator's to lift). */
  notRunnable: number;
  found: number;
  created: number;
  suspect: number;
  /** Gigs handed to deps.qualify, and how many of those calls threw. */
  qualified: number;
  qualifyFailed: number;
  /** True when the budget or the caller stopped the scan before its end. */
  aborted: boolean;
  /** The one source this run was narrowed to; null for a whole-workspace scan. */
  sourceId: string | null;
  /** What the research pass did; null when no researcher is plugged in, or the budget
   *  or the caller stopped the scan before it. */
  research: GigResearchBatchSummary | null;
};

/** Gigs researched in one scan at most: each is up to three page reads plus one model
 *  spawn, so eight keeps a scan's research inside the wall budget with room to spare. */
export const GIG_RESEARCH_MAX_PER_SCAN = 8;

/** What one research pass reports (gigs/research.ts researchGigBatch). */
export type GigResearchBatchSummary = {
  /** Gigs a brief was attempted for. */
  attempted: number;
  /** ...of which the model wrote the brief. */
  llm: number;
  /** ...of which kp wrote the deterministic brief (keyless, refused, failed). */
  deterministic: number;
  /** ...of which no brief could be stored (a store fault, logged server-side). */
  failed: number;
  /** Gigs a page they linked to flagged as a honeypot in this pass. */
  flagged: number;
  /** True once a spawn answered `no_provider`: every later gig got the deterministic
   *  brief with no further spawn (the first spawn doubles as the provider probe). */
  providerMissing: boolean;
};

/** The research hook: brief up to `limit` gigs of this workspace (narrowed to one source
 *  when `sourceId` is set). `htmlByGigId` carries the raw listing HTML this scan saw -
 *  the row stores only the text, and the HTML's hrefs are where most links live. Owns its
 *  own writes; a throw is logged, never fatal to the scan. */
export type GigResearchHook = (
  workspaceId: string,
  info: { signal: AbortSignal; limit: number; sourceId: string | null; htmlByGigId: ReadonlyMap<string, string | null> }
) => Promise<GigResearchBatchSummary>;

export type GigScanOptions = {
  /** Run only this source. Unknown here (deleted since the enqueue) = nothing runs. */
  sourceId?: string | null;
};

export type GigScanLogEvent = GigAdapterLogEvent & { sourceId?: string };

/** WP3's qualification hook: called once per upserted gig still in status `new`. It
 *  owns its own writes (setGigQualification + transitionGig); a throw is logged and
 *  counted, never fatal to the scan. */
export type GigQualifyHook = (workspaceId: string, gig: Gig, info: { created: boolean; signal: AbortSignal }) => unknown;

export type GigScanDeps = {
  listSources: (workspaceId: string) => GigSource[];
  adapterFor: (name: GigAdapterName) => GigAdapter;
  fetch: PoliteFetch;
  /** The ONLY door to adapter keys. */
  env: (name: string) => string | undefined;
  limits: GigAdapterLimits;
  upsertGigFromRaw: typeof upsertGigFromRaw;
  recordGigSourceRun: typeof recordGigSourceRun;
  pauseGigSource: typeof pauseGigSource;
  scanHoneypots: typeof scanGigForHoneypots;
  qualify?: GigQualifyHook;
  research?: GigResearchHook;
  now: () => string;
  wallBudgetMs: number;
  log: (event: GigScanLogEvent, error?: unknown) => void;
};

export function defaultGigScanDeps(): GigScanDeps {
  return {
    listSources: listGigSources,
    adapterFor: gigAdapterFor,
    fetch: politeFetch,
    env: (name) => process.env[name],
    limits: DEFAULT_GIG_ADAPTER_LIMITS,
    upsertGigFromRaw,
    recordGigSourceRun,
    pauseGigSource,
    scanHoneypots: scanGigForHoneypots,
    now: () => new Date().toISOString(),
    wallBudgetMs: GIG_SCAN_WALL_BUDGET_MS,
    log: (event, error) => {
      const line = `[gigs:scan] ${event.sourceId ? `${event.sourceId} ` : ""}${event.code}${event.detail ? ` - ${event.detail}` : ""}`;
      if (error !== undefined) console.error(line, error);
      else if (event.level === "warn") console.warn(line);
      else console.log(line);
    },
  };
}

/** The caller's signal joined with the scan's own wall budget. `budget` says which fired. */
function budgetSignal(outer: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  let budget = false;
  const timer = setTimeout(() => {
    budget = true;
    controller.abort(new Error("gig scan: wall budget exhausted"));
  }, ms);
  const onOuter = () => controller.abort(outer?.reason);
  if (outer?.aborted) onOuter();
  else outer?.addEventListener("abort", onOuter, { once: true });
  return {
    signal: controller.signal,
    budgetFired: () => budget,
    release: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    },
  };
}

class StoreError extends Error {
  readonly storeCause: unknown;
  constructor(storeCause: unknown) {
    super("gig store write failed");
    this.name = "StoreError";
    this.storeCause = storeCause;
  }
}

type Mapped = { outcome: GigSourceRunOutcome; reason: GigScanReason; pause: GigPauseReason | null };

function mapHalt(halt: FetchHalt): Mapped {
  switch (halt.outcome.kind) {
    case "blocked":
      return { outcome: "blocked", reason: "blocked", pause: "blocked" };
    case "offline":
      return { outcome: "offline", reason: "offline", pause: null };
    case "robots_disallowed":
      return { outcome: "failed", reason: "robots_disallowed", pause: null };
    case "gone":
      return { outcome: "failed", reason: "source_gone", pause: null };
    case "outage":
      return { outcome: "failed", reason: "source_outage", pause: null };
  }
}

export async function runGigScan(
  workspaceId: string,
  deps: GigScanDeps = defaultGigScanDeps(),
  signal?: AbortSignal,
  opts: GigScanOptions = {}
): Promise<GigScanSummary> {
  const startedAt = deps.now();
  const only = typeof opts.sourceId === "string" && opts.sourceId !== "" ? opts.sourceId : null;
  const listed = deps.listSources(workspaceId);
  const all = only ? listed.filter((s) => s.id === only) : listed;
  const sources = all.filter((s) => s.enabled && s.pausedReason === null);
  const summary: GigScanSummary = {
    workspaceId,
    startedAt,
    finishedAt: startedAt,
    sources: [],
    notRunnable: all.length - sources.length,
    found: 0,
    created: 0,
    suspect: 0,
    qualified: 0,
    qualifyFailed: 0,
    aborted: false,
    sourceId: only,
    research: null,
  };
  const budget = budgetSignal(signal, deps.wallBudgetMs);
  // The raw listing HTML this scan saw, per gig: the row keeps only the text, and the
  // research pass reads the HTML's hrefs.
  const htmlByGigId = new Map<string, string | null>();
  try {
    for (const source of sources) {
      if (budget.signal.aborted) {
        const reason: GigScanReason = budget.budgetFired() ? "wall_budget" : "aborted";
        summary.aborted = true;
        deps.recordGigSourceRun(workspaceId, source.id, "skipped");
        summary.sources.push({ sourceId: source.id, adapter: source.adapter, outcome: "skipped", reason, paused: null, found: 0, created: 0, suspect: 0 });
        continue;
      }
      const run = await runOneSource(workspaceId, source, deps, signal);
      summary.sources.push(run.summary);
      summary.found += run.summary.found;
      summary.created += run.summary.created;
      summary.suspect += run.summary.suspect;
      for (const { gig, bodyHtml } of run.landed) htmlByGigId.set(gig.id, bodyHtml);

      // Qualification AFTER the source's outcome is recorded: acquisition truth does
      // not wait on a model, and a gig left `new` by an abort is picked up next scan.
      if (deps.qualify) {
        for (const { gig, created } of run.landed) {
          if (budget.signal.aborted) break;
          if (gig.status !== "new") continue;
          summary.qualified += 1;
          try {
            await deps.qualify(workspaceId, gig, { created, signal: budget.signal });
          } catch (error) {
            summary.qualifyFailed += 1;
            deps.log({ level: "warn", code: "qualify_failed", detail: gig.id, sourceId: source.id }, error);
          }
        }
      }
    }
    // Research LAST: acquisition and qualification truth never wait on page reads or a
    // model. A gig left unresearched by the budget is picked up by the next scan.
    if (deps.research && !budget.signal.aborted) {
      try {
        summary.research = await deps.research(workspaceId, {
          signal: budget.signal,
          limit: GIG_RESEARCH_MAX_PER_SCAN,
          sourceId: only,
          htmlByGigId,
        });
      } catch (error) {
        deps.log({ level: "warn", code: "research_failed" }, error);
      }
    }
    if (budget.signal.aborted) summary.aborted = true;
    return { ...summary, finishedAt: deps.now() };
  } finally {
    budget.release();
  }
}

async function runOneSource(
  workspaceId: string,
  source: GigSource,
  deps: GigScanDeps,
  callerSignal: AbortSignal | undefined
): Promise<{ summary: GigSourceRunSummary; landed: { gig: Gig; created: boolean; bodyHtml: string | null }[] }> {
  const summary: GigSourceRunSummary = {
    sourceId: source.id,
    adapter: source.adapter,
    outcome: "succeeded",
    reason: null,
    paused: null,
    found: 0,
    created: 0,
    suspect: 0,
  };
  const landed: { gig: Gig; created: boolean; bodyHtml: string | null }[] = [];
  const finish = (m: Mapped | null) => {
    if (m) {
      summary.outcome = m.outcome;
      summary.reason = m.reason;
      if (m.pause) {
        deps.pauseGigSource(workspaceId, source.id, m.pause);
        summary.paused = m.pause;
      }
    }
    deps.recordGigSourceRun(workspaceId, source.id, summary.outcome);
    return { summary, landed };
  };
  const log = (event: GigAdapterLogEvent) => deps.log({ ...event, sourceId: source.id });
  try {
    const adapter = deps.adapterFor(source.adapter);
    const ctx = { source, fetch: deps.fetch, limits: deps.limits, env: deps.env, log };
    for await (const raw of adapter.discover(ctx)) {
      const reasons = deps.scanHoneypots({ bodyText: raw.bodyText, bodyHtml: raw.bodyHtml, title: raw.title });
      let result: { gig: Gig; created: boolean };
      try {
        result = deps.upsertGigFromRaw(workspaceId, { sourceId: source.id, arena: source.arena, raw, suspectReasons: reasons });
      } catch (error) {
        throw new StoreError(error);
      }
      summary.found += 1;
      if (result.created) summary.created += 1;
      if (reasons.length > 0) summary.suspect += 1;
      landed.push({ ...result, bodyHtml: raw.bodyHtml });
      if (summary.found >= deps.limits.maxItems) break;
      // Mid-source the budget is NOT enforced (never a half-run source), but a caller
      // cancellation is: an operator who pressed stop gets a stop.
      if (callerSignal?.aborted) break;
    }
    return finish(null);
  } catch (error) {
    if (error instanceof GigAdapterSkipped) {
      log({ level: "info", code: `skipped_${error.reason}`, detail: error.message });
      return finish({ outcome: "skipped", reason: error.reason, pause: error.reason === "no_key" ? "no_key" : null });
    }
    if (error instanceof AdapterCollapsed) {
      log({ level: "warn", code: "collapsed", detail: error.message });
      return finish({ outcome: "collapsed", reason: error.reason, pause: "collapsed" });
    }
    if (error instanceof FetchHalt) {
      const mapped = mapHalt(error);
      log({ level: "warn", code: mapped.reason, detail: error.outcome.detail });
      return finish(mapped);
    }
    if (error instanceof StoreError) {
      deps.log({ level: "warn", code: "store_error", sourceId: source.id }, error.storeCause);
      return finish({ outcome: "failed", reason: "store_error", pause: null });
    }
    deps.log({ level: "warn", code: "adapter_error", sourceId: source.id }, error);
    return finish({ outcome: "failed", reason: "adapter_error", pause: null });
  }
}
