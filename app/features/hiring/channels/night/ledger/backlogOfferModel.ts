/*
 * What the confirmation answered, counted for the post book's offer (pure, pinned by
 * backlogOfferModel.test.ts). The route answers one result per letter; the notice says each
 * delivery outcome once with its number and names every letter a gate stopped, so a skip is
 * never folded into a total. Type-only import of the server module: no server code reaches the client.
 */
import type { BacklogResult, BacklogSkipReason } from "@/app/_lib/comms-backlog.ts";

export type BacklogTally = {
  sent: number;
  failed: number;
  queued: number;
  skipped: { id: string; reason: BacklogSkipReason }[];
};

export function tallyBacklogResults(results: readonly BacklogResult[]): BacklogTally {
  const tally: BacklogTally = { sent: 0, failed: 0, queued: 0, skipped: [] };
  for (const r of results) {
    if (r.outcome === "skipped") tally.skipped.push({ id: r.id, reason: r.reason });
    else tally[r.outcome] += 1;
  }
  return tally;
}
