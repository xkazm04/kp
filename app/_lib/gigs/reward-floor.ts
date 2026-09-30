// The reward rules (operator, 2026-09-30): "Remove all gigs where no direct or non direct
// reward is stated, adjust the scan not to catch those" and "ignore freelancer activities
// under $50 ... including those converted from other currencies".
//
//   - no_reward: EVERY arena. A listing with no reward, or a reward with neither an amount
//     nor any stated text. A non-monetary reward the listing states ("Swag", "Knowledge") is
//     a stated reward and stays;
//   - below_floor_fixed: a FREELANCE listing whose budget CEILING is under
//     GIG_FIXED_FLOOR_USD. The ceiling, not `amount`: `amount` is the BOTTOM of a range
//     (freelancer.ts), and "$30-$250" is a $250 job;
//   - below_floor_hourly: a FREELANCE hourly listing whose top rate is under
//     GIG_HOURLY_FLOOR_USD an hour.
//
// THE CEILING is the largest figure the reward states (every number in `text`, commas
// stripped, a "k" suffix read as thousands, and `amount` itself) in US dollars: the scan's
// own rate when the reward carries one (`usd.rate`, units per ONE dollar), 1 for USD and the
// pegged stablecoins, else the rate table the caller passes. A currency with no rate has NO
// ceiling and is KEPT - the rule never guesses a rate. Hourly = the text says "/hr", "/hour",
// "per hour" or "hourly" (freelancer.ts and upwork.ts both write "/hr").
//
// Pure, with type-only imports, so the scan, the purge and a client surface can all read
// the same rule.

import type { FxTable } from "./fx";
import type { GigArena, GigReward } from "./types";

export const GIG_FIXED_FLOOR_USD = 50;
export const GIG_HOURLY_FLOOR_USD = 10;

export const GIG_EXCLUSIONS = ["no_reward", "below_floor_fixed", "below_floor_hourly"] as const;
export type GigExclusion = (typeof GIG_EXCLUSIONS)[number];

/** The operator-facing rule names the purge door takes: `below_floor` covers both floors. */
export const GIG_PURGE_RULES = ["no_reward", "below_floor"] as const;
export type GigPurgeRule = (typeof GIG_PURGE_RULES)[number];
export function isGigPurgeRule(v: unknown): v is GigPurgeRule {
  return typeof v === "string" && (GIG_PURGE_RULES as readonly string[]).includes(v);
}
export function purgeRuleOf(exclusion: GigExclusion): GigPurgeRule {
  return exclusion === "no_reward" ? "no_reward" : "below_floor";
}

/** Stablecoins pegged 1:1 (fx.ts USD_PEGGED, restated to keep this module import-free). */
const PEGGED = new Set(["USD", "USDC", "USDT"]);
const NUMBER_RE = /(\d+(?:\.\d+)?)(k\b)?/gi;
const HOURLY_RE = /\/\s*h(?:r|our)\b|\bper\s+hour\b|\bhourly\b/i;

function positive(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** Whether the listing states any reward at all (a figure or words). */
export function hasStatedReward(reward: GigReward | null | undefined): boolean {
  if (!reward) return false;
  if (positive(reward.amount)) return true;
  return typeof reward.text === "string" && reward.text.trim() !== "";
}

/** Whether the reward is an hourly rate. */
export function isHourlyReward(reward: GigReward | null | undefined): boolean {
  return !!reward && typeof reward.text === "string" && HOURLY_RE.test(reward.text);
}

/** The largest figure the reward states, in its own currency; null when it states none. */
export function rewardCeiling(reward: GigReward | null | undefined): number | null {
  if (!reward) return null;
  let max = positive(reward.amount) ? reward.amount : 0;
  const text = typeof reward.text === "string" ? reward.text.replace(/(\d),(?=\d{3}\b)/g, "$1") : "";
  for (const m of text.matchAll(NUMBER_RE)) {
    const n = Number(m[1]) * (m[2] ? 1000 : 1);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max > 0 ? max : null;
}

/** Units of the reward's currency per ONE US dollar, or null when no honest rate is known. */
export function rewardUsdRate(reward: GigReward, fx?: FxTable | null): number | null {
  if (reward.usd && positive(reward.usd.rate)) return reward.usd.rate;
  const currency = typeof reward.currency === "string" ? reward.currency.trim().toUpperCase() : "";
  if (!currency) return null;
  if (PEGGED.has(currency)) return 1;
  const hit = fx?.rates[currency];
  return hit && positive(hit.rate) ? hit.rate : null;
}

/** The reward's ceiling in US dollars; null = no figure, or no rate (never guessed). */
export function rewardCeilingUsd(reward: GigReward | null | undefined, fx?: FxTable | null): number | null {
  if (!reward) return null;
  const ceiling = rewardCeiling(reward);
  if (ceiling === null) return null;
  const rate = rewardUsdRate(reward, fx);
  return rate === null ? null : Math.round((ceiling / rate) * 100) / 100;
}

/** Why a listing (or a filed gig) is not wanted; null = keep it. */
export function gigExclusion(gig: { arena: GigArena; reward: GigReward | null }, fx?: FxTable | null): GigExclusion | null {
  if (!hasStatedReward(gig.reward)) return "no_reward";
  if (gig.arena !== "freelance") return null;
  const ceiling = rewardCeilingUsd(gig.reward, fx);
  if (ceiling === null) return null;
  if (isHourlyReward(gig.reward)) return ceiling < GIG_HOURLY_FLOOR_USD ? "below_floor_hourly" : null;
  return ceiling < GIG_FIXED_FLOOR_USD ? "below_floor_fixed" : null;
}

/** Whether a reward needs the rate table to be judged (freelance, non-USD, no stored rate). */
export function exclusionNeedsFx(gig: { arena: GigArena; reward: GigReward | null }): boolean {
  if (gig.arena !== "freelance" || !gig.reward || !hasStatedReward(gig.reward)) return false;
  if (rewardCeiling(gig.reward) === null) return false;
  if (gig.reward.usd && positive(gig.reward.usd.rate)) return false;
  const currency = typeof gig.reward.currency === "string" ? gig.reward.currency.trim().toUpperCase() : "";
  return currency !== "" && !PEGGED.has(currency);
}
