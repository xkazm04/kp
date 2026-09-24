// The gig adapter seam - the job-seeker acquisition seam (app/_lib/jobseeker/adapters/
// types.ts) with one step instead of two: an official gig API returns the whole listing
// in its list call, so an adapter yields RawGig directly and any per-item detail read
// (a GitHub bot comment, a HackerOne policy) is bounded by `limits.maxDetailFetches`.
//
// The context is the adapter's whole world. It fetches ONLY through `ctx.fetch` (the
// polite door, app/_lib/jobseeker/fetch/politeFetch.ts) and reads a key ONLY through
// `ctx.env` - an adapter never touches process.env or a store - so every adapter runs
// against fixtures with an injected key and zero network (adapters.test.ts).
//
// Three ways a run ends early, each a typed throw the scan maps to an outcome:
//   - AdapterCollapsed (shared with the job-seeker side): the provider answered in a
//     shape the adapter does not know -> `collapsed`, the source is paused;
//   - FetchHalt (shared): a fetch the run cannot continue without -> `blocked` (paused),
//     `offline`, or `failed`;
//   - GigAdapterSkipped: the adapter declined to run at all (no key, no public API, a
//     manual-only source) -> `skipped` with the reason, before any network.

import type { PoliteFetch } from "../../jobseeker/fetch/politeFetch";
import type { GigAdapterName, GigArena, GigSource, RawGig } from "../types";

export { AdapterCollapsed, FetchHalt } from "../../jobseeker/adapters/types";

export type GigAdapterLogEvent = { level: "info" | "warn"; code: string; detail?: string };

export type GigAdapterLimits = {
  /** Listings one run may yield from one source (pages x page size are bounded by it). */
  maxItems: number;
  /** Extra per-item reads one run may make (bot comments, program policies). */
  maxDetailFetches: number;
};

/** A twice-daily courtesy budget; the next run picks up what this one did not reach. */
export const DEFAULT_GIG_ADAPTER_LIMITS: GigAdapterLimits = { maxItems: 100, maxDetailFetches: 15 };

export type GigAdapterContext = {
  source: GigSource;
  fetch: PoliteFetch;
  limits: GigAdapterLimits;
  /** The ONLY door to a key. Production binds process.env; tests inject a map. */
  env: (name: string) => string | undefined;
  log(event: GigAdapterLogEvent): void;
};

export type GigAdapter = {
  name: GigAdapterName;
  /** The arena every listing of this adapter belongs to (GIG_ADAPTER_ARENA); null = manual. */
  arena: GigArena | null;
  discover(ctx: GigAdapterContext): AsyncIterable<RawGig>;
};

/** Every reason an adapter may decline to run. */
export const GIG_ADAPTER_SKIP_REASONS = ["no_key", "no_public_api", "manual_only"] as const;
export type GigAdapterSkipReason = (typeof GIG_ADAPTER_SKIP_REASONS)[number];

/** The adapter declined to run - thrown before any fetch. `no_key` pauses the source
 *  (`no_key`, lifted by the operator once the key is set); the others only record the
 *  run as `skipped`. */
export class GigAdapterSkipped extends Error {
  readonly reason: GigAdapterSkipReason;
  constructor(reason: GigAdapterSkipReason, detail?: string) {
    super(detail ?? reason);
    this.name = "GigAdapterSkipped";
    this.reason = reason;
  }
}

/** A discover that declines on its first pull - the same laziness as a generator that
 *  throws, without a generator that never yields. */
export function declinedDiscover(reason: GigAdapterSkipReason, detail?: string): AsyncIterable<RawGig> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.reject(new GigAdapterSkipped(reason, detail)),
    }),
  };
}
