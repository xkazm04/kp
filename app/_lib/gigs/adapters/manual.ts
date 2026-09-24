// manual: the operator forwards a brief by hand (the gigs forward route, createManualGig
// in app/_lib/db/gigs.ts). Nothing is discovered, so a scan that meets a `manual` source
// records it `skipped: manual_only` instead of pretending it ran. Present so every name
// in GIG_ADAPTERS resolves (pinned in adapters.test.ts).

import { declinedDiscover, type GigAdapter } from "./types";

export const manualAdapter: GigAdapter = {
  name: "manual",
  arena: null,
  discover: () => declinedDiscover("manual_only", "a manual source is filled by the operator, never scanned"),
};
