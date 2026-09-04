/** The spend bounds on a dispatched agent spec — ONE authority for TWO projections.
 *
 *  `app/api/agents/dispatch/route.ts` builds a `DispatchSpec` two ways: `mergedSpec`
 *  for the job path (stored AgentFitSpec + operator overrides) and
 *  `specFromAppMaster` for the App-master path (a composed AppMasterSpec). Both send
 *  the same two numbers to the executor, and both are spend controls — turns are
 *  paid model calls, the budget is the monthly ceiling — but only the job path
 *  bounded them. The codegen'd App-master contract bounds neither
 *  (`maxTurns: z.number().nullish()`, `monthlyUsd: z.number()`), so a composed spec
 *  carrying 5_000_000 turns and a negative monthly cap validated and went out on the
 *  wire.
 *
 *  They live here rather than in the route so the rule can be tested as the pure
 *  property it is: a route-level test would have to spend a real dispatch against
 *  `agent-dispatch:<ip>`'s 10 / 10 min budget, which is shared process-wide and
 *  already fully allocated by that file's existing cases.
 *
 *  Out of range answers `null` rather than clamping to the ceiling. The field's
 *  absence means "no limit declared", which is the honest reading of a number nobody
 *  could have meant; substituting the ceiling would invent a limit the operator
 *  never chose — the same reasoning the route already states when it refuses a
 *  present-but-unusable `budgetUsd` instead of swapping in the stored suggestion.
 */

/** The most turns a dispatched agent may be given. A turn is a paid model call. */
export const MAX_TURNS_CEILING = 1000;

/** A turn ceiling the executor can honour, else null (no ceiling declared). */
export function boundedTurns(raw: unknown): number | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 && raw <= MAX_TURNS_CEILING ? raw : null;
}

/** A monthly USD cap that is a real spend limit, else null (no cap declared). */
export function boundedBudget(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
}
