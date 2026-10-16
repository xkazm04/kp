import { positiveNumericEnv } from "./env.ts";

// The per-run LLM budget ceiling (ADR-0011: cost per run is unbounded by construction -
// S1 fan-out x S2 LLM calls - so a ceiling is a prerequisite for attaching a real
// producer, not a follow-up). SLATE_CAP bounds the fan-out; this bounds what the fan-out
// may spend.
//
// UNITS. The default provider is the Claude Code CLI (subscription-billed), which has no
// dollar cost: its ledger rows carry cost_usd NULL. So the primary ceilings are CALLS and
// TOKENS, both counted from the run's own llm_usage rows (role_run_id). A dollar ceiling
// is OPTIONAL and applies only to the part of the spend that has a price; an unpriced call
// is counted in `unpricedCalls` and never converted into a made-up dollar figure.
//
// Pure and DB-free: the engine reads the usage (db/llm.ts sumRoleRunUsage) and hands it here.

export type { RoleRunUsage } from "./db/llm.ts";
import type { RoleRunUsage } from "./db/llm.ts";

export const EMPTY_ROLE_RUN_USAGE: RoleRunUsage = { calls: 0, tokens: 0, costUsd: null, unpricedCalls: 0 };

export type RoleRunBudget = {
  maxCalls: number | null;
  maxTokens: number | null;
  /** Optional; only ever compared against priced spend. */
  maxCostUsd: number | null;
};

/** Defaults sized for the full 20-branch slate with a few LLM calls per stage, with
 *  headroom. Override per deployment with the env vars below. */
export const DEFAULT_ROLE_RUN_MAX_CALLS = 400;
export const DEFAULT_ROLE_RUN_MAX_TOKENS = 4_000_000;

/** Read the deployment's default ceiling:
 *  KP_ROLE_RUN_MAX_LLM_CALLS (default 400), KP_ROLE_RUN_MAX_LLM_TOKENS (default 4000000),
 *  KP_ROLE_RUN_MAX_COST_USD (default: no dollar ceiling). A non-numeric or non-positive
 *  value falls back to the default - a typo must not silently remove the guard. */
export function resolveRoleRunBudget(): RoleRunBudget {
  const rawCost = Number(process.env.KP_ROLE_RUN_MAX_COST_USD);
  return {
    maxCalls: Math.floor(positiveNumericEnv("KP_ROLE_RUN_MAX_LLM_CALLS", DEFAULT_ROLE_RUN_MAX_CALLS)),
    maxTokens: Math.floor(positiveNumericEnv("KP_ROLE_RUN_MAX_LLM_TOKENS", DEFAULT_ROLE_RUN_MAX_TOKENS)),
    maxCostUsd: Number.isFinite(rawCost) && rawCost > 0 ? rawCost : null,
  };
}

export type RoleRunBudgetDimension = "calls" | "tokens" | "cost_usd";

export type RoleRunBudgetBreach = {
  dimension: RoleRunBudgetDimension;
  used: number;
  ceiling: number;
};

/** The first ceiling the usage has REACHED (>=, so a run exactly at its ceiling stops
 *  rather than overspends by one stage), or null when it is under all of them. */
export function budgetBreach(usage: RoleRunUsage, budget: RoleRunBudget): RoleRunBudgetBreach | null {
  if (budget.maxCalls !== null && usage.calls >= budget.maxCalls) {
    return { dimension: "calls", used: usage.calls, ceiling: budget.maxCalls };
  }
  if (budget.maxTokens !== null && usage.tokens >= budget.maxTokens) {
    return { dimension: "tokens", used: usage.tokens, ceiling: budget.maxTokens };
  }
  if (budget.maxCostUsd !== null && usage.costUsd !== null && usage.costUsd >= budget.maxCostUsd) {
    return { dimension: "cost_usd", used: usage.costUsd, ceiling: budget.maxCostUsd };
  }
  return null;
}
