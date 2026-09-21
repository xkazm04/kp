// The adapter seam: discover refs, then resolve each to a RawPosting, through the
// polite fetcher the context hands in. An adapter never imports the fetcher or a
// store — the context is the whole world, which is what makes every adapter runnable
// against fixtures with zero network (adapters.test.ts).

import type { PoliteFetch, FetchFailure } from "../fetch/politeFetch";
import type { JobseekerPreferences, JobseekerSource, RawPosting, SourceAdapterName } from "../types";

export type PostingRef = {
  externalKey: string;
  url: string;
  /** What the listing already told us; a feed adapter's `detail` completes the posting from it without a fetch. */
  hint?: Partial<RawPosting>;
};

export type AdapterLogEvent = { level: "info" | "warn"; code: string; detail?: string };

export type AdapterLimits = {
  /** Refs one run may discover from one source (pages × page size are bounded by it). */
  maxRefs: number;
  /** Detail pages one run may fetch from one source (feeds that carry the body use none). */
  maxDetailFetches: number;
};

export const DEFAULT_ADAPTER_LIMITS: AdapterLimits = { maxRefs: 500, maxDetailFetches: 60 };

export type AdapterContext = {
  source: JobseekerSource;
  preferences: JobseekerPreferences;
  fetch: PoliteFetch;
  limits: AdapterLimits;
  log(event: AdapterLogEvent): void;
};

export type SourceAdapter = {
  name: SourceAdapterName;
  /** True when `detail` may fetch a page per ref (reconcile bounds the calls by `maxDetailFetches`). */
  detailFetches: boolean;
  discover(ctx: AdapterContext): AsyncIterable<PostingRef>;
  detail(ref: PostingRef, ctx: AdapterContext): Promise<RawPosting | null>;
};

/** The source answered but not in the shape the adapter knows: an API that dropped
 *  its items array, a listing page where every required rule matched nothing. The
 *  run outcome is `collapsed`, the source is paused, the owner is told. */
export class AdapterCollapsed extends Error {
  readonly reason: "shape_changed" | "required_rule_miss";
  constructor(reason: "shape_changed" | "required_rule_miss", detail?: string) {
    super(detail ?? reason);
    this.name = "AdapterCollapsed";
    this.reason = reason;
  }
}

/** A fetch that ends the source's run: `blocked` (the source is paused), `offline`,
 *  or an outage/gone/robots refusal on a page the adapter cannot proceed without. */
export class FetchHalt extends Error {
  readonly outcome: FetchFailure;
  constructor(outcome: FetchFailure) {
    super(`${outcome.kind}: ${outcome.detail}`);
    this.name = "FetchHalt";
    this.outcome = outcome;
  }
}
