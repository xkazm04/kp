// The purge of what the reward rules exclude (gigs/reward-floor.ts; POST /api/gigs/purge).
// The operator (2026-09-30) asked for every gig with no stated reward, and every freelance gig
// under the floors, to leave the database - any arena, any status. The same rules keep them
// out of every later scan (gigs/scan.ts), so a purged gig is not filed again.
//
// DRY RUN FIRST: `dryRun` defaults to true at the door, and a dry run writes nothing - it
// answers what a real run would delete: the count, by rule, status and arena, the first 20,
// the children that go with them, the personas to retire and the files left on disk.
//
// A REAL RUN:
//   1. judges every gig of the workspace (the rate table read at most once, and only when a
//      freelance reward in another currency has no stored rate; no table = no ceiling = KEPT);
//   2. reads the gig personas BEFORE deleting; a persona whose hire is still live is kept in
//      the delete and retired after it, the rest go with their gig;
//   3. deletes in ONE synchronous `.immediate()` transaction per batch (db/gigs-purge.ts),
//      re-asserting the rule on each row read inside it; a gig with an outcome is never
//      deleted (the outcomes are append-only);
//   4. AFTER the transactions, retires each live persona through the sync's own retire path
//      (Personas, then the hire -> `retired`), then drops its row. Best-effort: a refusal
//      never undoes the delete - the row stays and the sync's retire step (a gig that is gone)
//      retries it on its next pass. Counted `personasRetired` / `personasFailed`.
// Files on disk (workdirs, reports, proposals) are left alone and counted.

import { ACTIVE_AGENT_STATUSES, getHiredAgent } from "../db/agents";
import { deleteGigPersonaRow, deleteGigsWithChildren, listGigPurgeCandidates, readGigPurgeChildren, type GigPurgeCandidate } from "../db/gigs-purge";
import { loadFxRates, type FxTable } from "./fx";
import { exclusionNeedsFx, gigExclusion, purgeRuleOf, type GigPurgeRule } from "./reward-floor";
import { retireGigPersonaHire } from "./persona-retire";
import type { GigReward } from "./types";

export const GIG_PURGE_SAMPLE = 20;

export type GigPurgeReport = {
  dryRun: boolean;
  rules: GigPurgeRule[];
  /** Gigs the rules match (a real run: matched before the delete). */
  count: number;
  byRule: Record<GigPurgeRule, number>;
  byStatus: Record<string, number>;
  byArena: Record<string, number>;
  sample: { id: string; title: string; status: string; reward: GigReward | null }[];
  /** Freelance rewards in another currency with no rate: no ceiling, so KEPT. */
  unconverted: number;
  /** Whether the USD rate table was needed and read. */
  fx: "not_needed" | "read" | "unavailable";
  children: { plans: number; attempts: number; attemptCostUsd: number; personas: number };
  /** Matched gigs with a recorded outcome: never deleted. */
  keptWithOutcome: number;
  /** Left on disk, never touched: gigs with a workdir, a report, a proposal. */
  filesLeft: { workdirs: number; reports: number; proposals: number };
  /** Real run only. */
  deleted?: number;
  /** Real run only: gigs that no longer matched inside the transaction. */
  changed?: number;
  personasRetired?: number;
  personasFailed?: number;
};

export type GigPurgeDeps = {
  fxRates: () => Promise<FxTable | null>;
  retire: typeof retireGigPersonaHire;
  log: (line: string, error?: unknown) => void;
};

export function defaultGigPurgeDeps(): GigPurgeDeps {
  return {
    fxRates: () => loadFxRates(),
    retire: retireGigPersonaHire,
    log: (line, error) => (error === undefined ? console.warn(`[gigs:purge] ${line}`) : console.error(`[gigs:purge] ${line}`, error)),
  };
}

function tally(into: Record<string, number>, key: string): void {
  into[key] = (into[key] ?? 0) + 1;
}

export async function runGigPurge(
  workspaceId: string,
  req: { rules: readonly GigPurgeRule[]; dryRun: boolean },
  deps: GigPurgeDeps = defaultGigPurgeDeps()
): Promise<GigPurgeReport> {
  const rules = [...new Set(req.rules)];
  const all = listGigPurgeCandidates(workspaceId);
  const floor = rules.includes("below_floor");
  let fx: FxTable | null = null;
  let fxState: GigPurgeReport["fx"] = "not_needed";
  if (floor && all.some(exclusionNeedsFx)) {
    try {
      fx = await deps.fxRates();
    } catch (error) {
      deps.log("the rate table could not be read; non-USD freelance rewards are kept", error);
    }
    fxState = fx ? "read" : "unavailable";
  }
  const matches = (gig: { arena: GigPurgeCandidate["arena"]; reward: GigReward | null }): GigPurgeRule | null => {
    const why = gigExclusion(gig, fx);
    const rule = why ? purgeRuleOf(why) : null;
    return rule && rules.includes(rule) ? rule : null;
  };

  const report: GigPurgeReport = {
    dryRun: req.dryRun,
    rules,
    count: 0,
    byRule: { no_reward: 0, below_floor: 0 },
    byStatus: {},
    byArena: {},
    sample: [],
    unconverted: 0,
    fx: fxState,
    children: { plans: 0, attempts: 0, attemptCostUsd: 0, personas: 0 },
    keptWithOutcome: 0,
    filesLeft: { workdirs: 0, reports: 0, proposals: 0 },
  };
  const hits: GigPurgeCandidate[] = [];
  for (const gig of all) {
    const rule = matches(gig);
    if (!rule) {
      if (floor && !fx && exclusionNeedsFx(gig)) report.unconverted += 1;
      continue;
    }
    hits.push(gig);
    report.byRule[rule] += 1;
    tally(report.byStatus, gig.status);
    tally(report.byArena, gig.arena);
    if (report.sample.length < GIG_PURGE_SAMPLE) report.sample.push({ id: gig.id, title: gig.title, status: gig.status, reward: gig.reward });
    if (gig.hasWorkdir) report.filesLeft.workdirs += 1;
    if (gig.hasReport) report.filesLeft.reports += 1;
    if (gig.hasProposal) report.filesLeft.proposals += 1;
  }
  report.count = hits.length;
  const children = readGigPurgeChildren(workspaceId, hits.map((g) => g.id));
  report.children = { plans: children.plans, attempts: children.attempts, attemptCostUsd: children.attemptCostUsd, personas: children.personas.length };
  report.keptWithOutcome = children.withOutcome.size;
  if (req.dryRun) return report;

  // The live hires are retired AFTER the delete; their rows stay until then.
  const live = children.personas
    .map((p) => ({ ...p, agent: getHiredAgent(p.hiredAgentId, workspaceId) }))
    .filter((p) => p.agent !== null && ACTIVE_AGENT_STATUSES.includes(p.agent.status));
  const res = deleteGigsWithChildren(
    workspaceId,
    hits.map((g) => g.id),
    { stillMatches: (gig) => matches(gig) !== null, keepSpecialistIds: new Set(live.map((p) => p.specialistId)) }
  );
  report.deleted = res.deleted.length;
  report.changed = res.changed.length;
  report.keptWithOutcome = res.keptWithOutcome.length;
  report.personasRetired = 0;
  report.personasFailed = 0;
  const gone = new Set(res.deleted);
  for (const p of live) {
    if (!gone.has(p.gigId) || !p.agent) continue;
    let ok = false;
    try {
      ok = await deps.retire(workspaceId, p.agent, "gig_purged");
    } catch (error) {
      deps.log(`retiring persona ${p.specialistId} failed; the sync retries it`, error);
    }
    if (ok) {
      deleteGigPersonaRow(workspaceId, p.specialistId);
      report.personasRetired += 1;
    } else report.personasFailed += 1;
  }
  return report;
}
