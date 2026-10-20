// algora: Algora-hosted open-source bounties - SKIPPED, `no_public_api`.
//
// Checked 2026-09-24 before writing this file:
//   - algora.io/api/bounties answers 200 with the HTML app shell, not JSON;
//   - console.algora.io/api/bounties 301s to that same shell;
//   - the documented REST reference (api.docs.algora.io) did not answer, and the org
//     path it is quoted as (`/api/orgs/{org}/bounties`) is 404 on both hosts;
//   - console.algora.io/api/trpc/bounty.list answers JSON, but it is undocumented and
//     returns an empty list even for orgs whose public board shows open bounties - a
//     dead legacy procedure, not an API.
// An adapter that scraped the board HTML would be exactly what GIG_ADAPTERS rules out,
// so this one declines before any network and the run is recorded `skipped` with the
// reason. Algora bounties still reach the desk: they are GitHub issues carrying the
// "💎 Bounty" label and an algora-pbc bot comment, which github_bounty reads (configure
// its `labels` with "💎 Bounty").

import { declinedDiscover, type GigAdapter } from "./types";

export const ALGORA_HOST = "algora.io";

export const algoraAdapter: GigAdapter = {
  name: "algora",
  arena: "oss_bounty",
  discover: () =>
    declinedDiscover("no_public_api", "Algora publishes no documented JSON bounty endpoint; use github_bounty with the Algora label"),
};
