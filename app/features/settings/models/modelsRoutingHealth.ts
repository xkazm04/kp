// Routing health: what each use case actually SERVED since its pin was set, and the
// one repair that state calls for. Pure, so the Models > Routing row renders it and
// node:test pins it without a DOM.
//
// Input is the store's per-use-case ledger read (db/llm-routing-health.ts `routingHealth`, already
// cut at max(window start, effective pin updatedAt)) plus the effective pin. The
// cut lives in the store; the rule here is only how the read becomes a state:
//
//   no rows since the cut   pinned -> unproven (nothing has proven this pin yet)
//                           not    -> idle
//   newest row failed       -> failing        (repair: Test)
//   newest row a template   -> falling_back   (repair: Keys when the reason is a
//                                              key/endpoint, none for a policy seal,
//                                              else Test)
//   newest row a provider   -> drift when a pin names a different routing provider
//                              (repair: Test), else serving
//
// "Newest" rather than a majority, because the row answers "what serves this NOW":
// a use case that worked all week and timed out this morning is failing.

import type { LlmConfigRow } from "@/app/_lib/db/llm";
import type { RoutingHealthRow } from "@/app/_lib/db/llm-routing-health";

export const ROUTING_HEALTH_STATES = ["serving", "falling_back", "failing", "drift", "unproven", "idle"] as const;
export type RoutingHealthState = (typeof ROUTING_HEALTH_STATES)[number];

export type RoutingRepair = "keys" | "test" | "none";

export type RoutingHealth = {
  state: RoutingHealthState;
  /** The ledger's closed-vocabulary code for a fallback or failure; null otherwise. */
  reason: string | null;
  /** The provider/model that answered (serving, drift); null when none did. */
  served: { provider: string; model: string | null } | null;
  lastAt: string | null;
  repair: RoutingRepair;
};

/** Descents an operator repairs on the Keys section (base.AVAILABILITY_REASONS). */
const KEY_REASONS: ReadonlySet<string> = new Set(["missing_key", "missing_endpoint", "invalid_base_url"]);
/** Descents that are a deliberate policy, not a fault: nothing to press. */
const POLICY_REASONS: ReadonlySet<string> = new Set(["offline_policy", "consumer_terms_policy", "disabled"]);

/** The pin a use case actually runs under: its own row, else the '*' catch-all
 *  (pipeline/jobfit/llm/config.py `for_use_case`), else none. */
export function effectivePin(
  useCase: string,
  rows: readonly Pick<LlmConfigRow, "useCase" | "provider" | "updatedAt">[]
): { provider: string; updatedAt: string } | null {
  const own = rows.find((r) => r.useCase === useCase) ?? rows.find((r) => r.useCase === "*");
  return own ? { provider: own.provider, updatedAt: own.updatedAt } : null;
}

export function classifyRoutingHealth(
  pin: { provider: string; updatedAt: string } | null,
  health: RoutingHealthRow | undefined,
  /** The routing catalogue (GET /api/llm/config `providers`). A served provider
   *  outside it - a TS-direct voice or TTS writer - is never called drift: it is
   *  not something a pin could have named. Passed in, because llm-config.ts is
   *  server-only and this module ships to the client. */
  routingProviders: readonly string[]
): RoutingHealth {
  // A read cut BEFORE the current pin (the table re-pinned in place and has not
  // re-fetched the ledger) is about the provider it replaced: not evidence here.
  if (health && pin && health.since < pin.updatedAt) health = undefined;
  if (!health) {
    return pin
      ? { state: "unproven", reason: null, served: null, lastAt: null, repair: "test" }
      : { state: "idle", reason: null, served: null, lastAt: null, repair: "none" };
  }
  const { last } = health;
  if (last.outcome === "failed") {
    return { state: "failing", reason: last.reason, served: null, lastAt: last.at, repair: "test" };
  }
  if (last.source === "deterministic") {
    const reason = last.reason;
    const repair: RoutingRepair =
      reason && KEY_REASONS.has(reason) ? "keys" : reason && POLICY_REASONS.has(reason) ? "none" : "test";
    return { state: "falling_back", reason, served: null, lastAt: last.at, repair };
  }
  const served = { provider: last.provider, model: last.model };
  if (pin && pin.provider !== last.provider && routingProviders.includes(last.provider)) {
    return { state: "drift", reason: null, served, lastAt: last.at, repair: "test" };
  }
  return { state: "serving", reason: null, served, lastAt: last.at, repair: "none" };
}

/** The same page with the Models section switched: the Keys repair is an address
 *  (`?modelSec=keys`, read by ModelsTab), not a new route. Returns path + query. */
export function withModelSection(href: string, section: "routing" | "quality" | "keys"): string {
  const url = new URL(href);
  url.searchParams.set("modelSec", section);
  return `${url.pathname}${url.search}${url.hash}`;
}
