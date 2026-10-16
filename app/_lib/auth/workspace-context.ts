import { NextResponse } from "next/server";
import { currentWorkspace } from "./current-workspace";
import { currentSession } from "./current-user";

// The ONE request-scoped entry for a workspace-scoped route (ADR draft-route-chain-
// refusal-order). A route used to open with `const ws = await currentWorkspace()` and
// carry its own idea of when to refuse; 223 route files did it 270+ times, so a new
// route that forgot the tenant argument silently read the DEFAULT team.
//
//   export const GET = withWorkspace(async (ws, request: Request) => { ... });
//   export const POST = route(withRateLimit({ ... }), withMeterGate("ai_candidates"))(
//     async (ws, request: Request) => { ... });
//
// The handler receives the resolved workspace as its FIRST argument and its own
// arguments after it, unchanged — (request), (request, { params }) or none — so the body
// of a migrated handler is the old body minus the resolver line.
//
// REFUSAL ORDER (this is the part that changed, deliberately):
//   1. session  — password mode + no live session            -> 401 { error: "Unauthorized" }
//   2. guards   — in the order written in route(...): rate limit (429), meter (402)
//   3. handler  — its own gates: requireOperator, capability seat, validation, 404s
// Open mode (KP_OPERATOR_PASSWORD unset) never refuses at step 1 and resolves to the
// default workspace, exactly as currentWorkspace() always did. The 401 is the proxy's
// own rule (proxy.ts gates every non-public route) re-asserted at the handler, so a
// matcher gap cannot reach a store with a guessed tenant. Public token routes are NOT
// wrapped: their authority is the capability link, never a session.

/** A handler that has been given its workspace. `A` is the rest of the arguments. */
export type WsHandler<A extends unknown[], R extends Response = Response> = (
  ws: string,
  ...args: A
) => R | Promise<R>;

/** A guard wraps a workspace handler and may refuse before it runs. */
export type Guard = <A extends unknown[]>(next: WsHandler<A>) => WsHandler<A>;

const UNAUTHORIZED = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

/** Step 1 alone: the workspace for this request, or null when a session is required and
 *  absent. Exported for the cross-workspace tests; routes use withWorkspace/route. */
export async function resolveRequestWorkspace(): Promise<string | null> {
  if (process.env.KP_OPERATOR_PASSWORD && (await currentSession()) === null) return null;
  return currentWorkspace();
}

/** Compose guards left to right (the first one written refuses first) around a handler
 *  that receives the workspace. The workspace step is always outermost: it cannot be
 *  omitted from a chain. */
export function route(...guards: Guard[]) {
  return <A extends unknown[], R extends Response>(handler: WsHandler<A, R>): ((...args: A) => Promise<R | NextResponse>) => {
    // Right fold so guards[0] is outermost, i.e. runs first.
    const chained = guards.reduceRight<WsHandler<A>>((next, guard) => guard(next), handler as WsHandler<A>);
    return async (...args: A) => {
      const ws = await resolveRequestWorkspace();
      if (ws === null) return UNAUTHORIZED();
      return (await chained(ws, ...args)) as R;
    };
  };
}

/** A route with no guards beyond the workspace. */
export const withWorkspace = route();

/** The same session step for a handler that needs NO tenant (a deployment-wide read, the
 *  provider-key writes): it gets its own arguments, unchanged, with no workspace in front.
 *  It exists so such a route is still behind the one entry (and the ratchet counts it)
 *  without carrying an unused parameter. A handler that touches a store takes
 *  withWorkspace, never this. */
export function withSession<A extends unknown[], R extends Response>(handler: (...args: A) => R | Promise<R>): (...args: A) => Promise<R | NextResponse> {
  return async (...args: A) => {
    if ((await resolveRequestWorkspace()) === null) return UNAUTHORIZED();
    return handler(...args);
  };
}
