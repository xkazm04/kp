// gigAdapterFor(name): the closed vocabulary in gigs/types.ts -> its implementation.
// Every name in GIG_ADAPTERS has an entry (pinned in adapters.test.ts), so a source row
// can always be run or recorded `skipped` with a reason, never dropped on the floor.

import type { GigAdapterName } from "../types";
import { algoraAdapter, ALGORA_HOST } from "./algora";
import { freelancerAdapter, FREELANCER_HOST } from "./freelancer";
import { githubBountyAdapter, GITHUB_API_HOST } from "./githubBounty";
import { hackeroneAdapter, HACKERONE_API_HOST } from "./hackerone";
import { kaggleAdapter, KAGGLE_HOST } from "./kaggle";
import { manualAdapter } from "./manual";
import type { GigAdapter } from "./types";
import { upworkAdapter, UPWORK_API_HOST } from "./upwork";

const ADAPTERS: Record<GigAdapterName, GigAdapter> = {
  manual: manualAdapter,
  github_bounty: githubBountyAdapter,
  algora: algoraAdapter,
  kaggle: kaggleAdapter,
  hackerone: hackeroneAdapter,
  freelancer_api: freelancerAdapter,
  upwork_api: upworkAdapter,
};

export function gigAdapterFor(name: GigAdapterName): GigAdapter {
  return ADAPTERS[name];
}

/** The host a source with this adapter talks to - the politeness key and the value the
 *  store writes to gig_sources.host. Every official API has a fixed host, so config does
 *  not move it today; the parameter keeps the job-seeker signature for an adapter whose
 *  host is config-derived. Null for `manual`: a forwarded brief has no source row to
 *  fetch from, so the route refuses to create one. */
export function gigHostForAdapter(name: GigAdapterName, config: Record<string, unknown> = {}): string | null {
  void config;
  switch (name) {
    case "manual":
      return null;
    case "github_bounty":
      return GITHUB_API_HOST;
    case "algora":
      return ALGORA_HOST;
    case "kaggle":
      return KAGGLE_HOST;
    case "hackerone":
      return HACKERONE_API_HOST;
    case "freelancer_api":
      return FREELANCER_HOST;
    case "upwork_api":
      return UPWORK_API_HOST;
  }
}
