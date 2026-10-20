// Routing health for Models > Routing: what SERVED each use case since its pin was
// set (docs/architecture/llm-provider-layer.md). Its own module rather than a
// section of db/llm.ts, because db/llm.ts sits in nearly every route's import graph
// (perf-budget.json) and only GET /api/llm/config reads this.
import { ROUTING_HEALTH_WINDOW_DAYS } from "../llm-usage-ledger";
import { ensureDb } from "./core";

/**
 * What the ledger says served ONE use case since its effective pin was set: counts
 * split by what answered (a provider, the template floor, or nothing - a failed
 * attempt), the newest row, and the newest real provider serve. Aggregated from the
 * same deployment-wide, tenancy-exempt `llm_usage` rows the Activity and usage
 * routes already list; `reason` is the column's closed-vocabulary code, never text.
 */
export type RoutingHealthRow = {
  useCase: string;
  /** The cut this row was counted from: max(window start, effective pin updatedAt). */
  since: string;
  /** source 'llm', outcome 'ok' - a provider answered. */
  llmOk: number;
  /** source 'deterministic' - the template floor answered instead. */
  deterministic: number;
  /** outcome 'failed' - the attempt raised. */
  failed: number;
  last: {
    at: string;
    provider: string;
    model: string | null;
    source: string;
    outcome: string;
    reason: string | null;
  };
  lastServed: { at: string; provider: string; model: string | null } | null;
};

/**
 * Per-use-case routing health for `useCases`, each counted from max(window start,
 * the use case's effective pin `updatedAt`) - its own `llm_config` row, else the
 * '*' catch-all row, exactly the fallback `config.for_use_case` resolves. The cut
 * is the point: a re-pinned use case is never credited with the traffic of the
 * provider it replaced. A use case with no rows since its cut is ABSENT from the
 * result (the classifier reads that as unproven when pinned, idle when not), and
 * ids outside `useCases` (ledger-only probes) are never returned.
 */
export function routingHealth(
  useCases: readonly string[],
  sinceDays = ROUTING_HEALTH_WINDOW_DAYS
): Record<string, RoutingHealthRow> {
  const db = ensureDb();
  const windowStart = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const pins = new Map(
    (db.prepare(`SELECT use_case, updated_at FROM llm_config`).all() as Array<{ use_case: string; updated_at: string }>).map(
      (r) => [r.use_case, r.updated_at] as const
    )
  );
  const catchAll = pins.get("*");
  const counts = db.prepare(
    `SELECT SUM(CASE WHEN source = 'llm' AND outcome = 'ok' THEN 1 ELSE 0 END) AS llm_ok,
            SUM(CASE WHEN source = 'deterministic' AND outcome = 'ok' THEN 1 ELSE 0 END) AS deterministic,
            SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM llm_usage WHERE use_case = ? AND ts > ?`
  );
  const newest = db.prepare(
    `SELECT ts, provider, model, source, outcome, reason
       FROM llm_usage WHERE use_case = ? AND ts > ?
      ORDER BY ts DESC, id DESC LIMIT 1`
  );
  const newestServed = db.prepare(
    `SELECT ts, provider, model
       FROM llm_usage WHERE use_case = ? AND ts > ? AND source = 'llm' AND outcome = 'ok'
      ORDER BY ts DESC, id DESC LIMIT 1`
  );
  const out: Record<string, RoutingHealthRow> = {};
  for (const useCase of useCases) {
    if (useCase === "*") continue; // a pin, never a ledger use case
    const pinnedAt = pins.get(useCase) ?? catchAll;
    const since = pinnedAt && pinnedAt > windowStart ? pinnedAt : windowStart;
    const last = newest.get(useCase, since) as Record<string, unknown> | undefined;
    if (!last) continue;
    const c = counts.get(useCase, since) as Record<string, unknown>;
    const served = newestServed.get(useCase, since) as Record<string, unknown> | undefined;
    out[useCase] = {
      useCase,
      since,
      llmOk: Number(c.llm_ok ?? 0),
      deterministic: Number(c.deterministic ?? 0),
      failed: Number(c.failed ?? 0),
      last: {
        at: last.ts as string,
        provider: last.provider as string,
        model: (last.model as string) ?? null,
        source: last.source as string,
        outcome: (last.outcome as string) ?? "ok",
        reason: (last.reason as string) ?? null,
      },
      lastServed: served
        ? { at: served.ts as string, provider: served.provider as string, model: (served.model as string) ?? null }
        : null,
    };
  }
  return out;
}
