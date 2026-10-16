import { jsonRefusal } from "../api-response";
import { clientIpFrom, rateLimit, rateLimitRetryAfterMs } from "../rate-limit";
import { jsonThrottled } from "../throttle-response";
import { meterGate } from "../billing/enforce";
import type { Meter } from "../billing/plans";
import type { Guard, WsHandler } from "./workspace-context";

// Composable guards for route(...) (workspace-context.ts). Each one is the ordinary
// call a route used to make by hand, hoisted to a declaration on the export line so the
// limiter and the meter are visible in ONE place and run in the order they are written.
//
// By convention the first handler argument after the workspace is the Request; guards
// that need it read it from there. A guard runs BEFORE every gate the handler itself
// owns, so use it only where the old call site was the first refusal. A limiter that
// had to stay behind a cheaper gate (`servedBefore` in rate-limit-contract.test.ts)
// remains a call in the body.

export type RateLimitGuardConfig = {
  /** The limiter key, built from the workspace and the request. Start it with the
   *  family prefix (`tts:`); /api/ops counts refusals per prefix. */
  key: (ctx: { ws: string; request: Request }) => string;
  limit: number;
  windowMs: number;
  /** Say WHEN to come back (Retry-After from the window that refused). Default: the
   *  bare coded 429, as jsonRefusal("TOO_MANY_REQUESTS", 429). */
  retryAfter?: boolean;
};

/** The client key most limiters use, so a config reads `\`tts:${ip(request)}\``. */
export const clientKey = (request: Request): string => clientIpFrom(request.headers);

export function withRateLimit(config: RateLimitGuardConfig): Guard {
  return <A extends unknown[]>(next: WsHandler<A>): WsHandler<A> =>
    async (ws, ...args) => {
      const request = args[0] as Request;
      const key = config.key({ ws, request });
      if (!rateLimit(key, { limit: config.limit, windowMs: config.windowMs })) {
        return config.retryAfter
          ? jsonThrottled(rateLimitRetryAfterMs(key), config.windowMs)
          : jsonRefusal("TOO_MANY_REQUESTS", 429);
      }
      return next(ws, ...args);
    };
}

export type MeterGuardConfig = {
  /** Worst-case units this action can consume (default 1), see meterGate. */
  minUnits?: (ctx: { ws: string; request: Request }) => number;
};

/** A hard billing gate: 402 BILLING_QUOTA_EXCEEDED when the workspace's org cannot fund
 *  the action. Only for a gate whose units are known before the body is read; a gate
 *  that sizes itself from the parsed body stays a call in the handler. */
export function withMeterGate(meter: Meter, config: MeterGuardConfig = {}): Guard {
  return <A extends unknown[]>(next: WsHandler<A>): WsHandler<A> =>
    async (ws, ...args) => {
      const request = args[0] as Request;
      const verdict = meterGate(meter, { workspace: ws, minUnits: config.minUnits?.({ ws, request }) });
      if (verdict) return jsonRefusal("BILLING_QUOTA_EXCEEDED", 402, { meter: verdict.meter, plan: verdict.plan });
      return next(ws, ...args);
    };
}
