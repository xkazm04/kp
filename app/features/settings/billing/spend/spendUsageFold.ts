// Pure, DOM-free folding for UsagePanel so the per-use-case rollup — including the
// deterministic-vs-LLM split (#5) and the unpriced-calls signal (#3) — is
// unit-testable under `node --test` (a `.tsx` can't be loaded by the runner).
import type { LlmUsageAggregateRow } from "@/app/_lib/db/llm";

export type UseCaseTotals = {
  useCase: string;
  calls: number;
  // bug-ui-scan-2026-07-09 (model-api-key-management #5): calls served by the
  // deterministic template fallback (provider="deterministic"), NOT a real LLM.
  deterministicCalls: number;
  // bug-ui-scan-2026-07-09 (model-api-key-management #3): calls whose cost_usd was
  // NULL (Azure / unknown-model spend) and so summed to $0 — "unknown", not "$0".
  unpricedCalls: number;
  // tiger X2: attempts that RAISED. Carried through the fold rather than dropped,
  // because a use case whose spend went quiet because its provider is failing and one
  // nobody used look identical in every other number on this row.
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
};

/** Fold the day×provider×model rollups into one row per use case, spendiest first. */
export function foldByUseCase(rows: readonly LlmUsageAggregateRow[]): UseCaseTotals[] {
  const byUseCase = new Map<string, UseCaseTotals>();
  for (const row of rows) {
    const acc = byUseCase.get(row.useCase) ?? {
      useCase: row.useCase,
      calls: 0,
      deterministicCalls: 0,
      unpricedCalls: 0,
      failedCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      costUsd: 0,
    };
    acc.calls += row.calls;
    // #5: the provider dimension is collapsed for the headline count, so preserve
    // the one signal that separates a real LLM call from a keyless/fallback serve.
    if (row.provider === "deterministic") acc.deterministicCalls += row.calls;
    // #3: carry the unpriced-call count so the panel can say "N unpriced" instead
    // of presenting an authoritative-looking $0.00 for real Azure/custom spend.
    acc.unpricedCalls += row.unpricedCalls;
    acc.failedCalls += row.failedCalls;
    acc.inputTokens += row.inputTokens;
    acc.outputTokens += row.outputTokens;
    acc.cachedTokens += row.cachedTokens;
    acc.costUsd += row.costUsd;
    byUseCase.set(row.useCase, acc);
  }
  return [...byUseCase.values()].sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls);
}

export type UsageSum = Omit<UseCaseTotals, "useCase">;

/** Grand totals across every use case (the table's footer row). */
export function sumTotals(totals: readonly UseCaseTotals[]): UsageSum {
  return totals.reduce<UsageSum>(
    (acc, r) => ({
      calls: acc.calls + r.calls,
      deterministicCalls: acc.deterministicCalls + r.deterministicCalls,
      unpricedCalls: acc.unpricedCalls + r.unpricedCalls,
      failedCalls: acc.failedCalls + r.failedCalls,
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      cachedTokens: acc.cachedTokens + r.cachedTokens,
      costUsd: acc.costUsd + r.costUsd,
    }),
    { calls: 0, deterministicCalls: 0, unpricedCalls: 0, failedCalls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0 }
  );
}
