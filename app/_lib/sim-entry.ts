// The ONE way a /api/sim/* route reads or writes a pipeline entry by id.
//
// The guided-sim doors ask no capability (route-capability-coverage.test.ts exempts
// them as a "guided-sim sandbox"), so any signed-in seat — a viewer included, and the
// anonymous demo-workspace session /api/demo mints — reaches them. That exemption is
// only honest if the doors can touch nothing but the demo corpus. The demo plane and
// the real plane share the pipeline store; the `(SIM)` title marker is what separates
// them, and the reset (sim-store.ts), the analytics filters and comms dispatch
// (comms-dispatch.ts, which keeps only a (SIM) title off the real channel) all key on
// it. Before this gate three sim doors did not: they resolved ANY entry in the
// caller's team, so a viewer could overwrite a real candidate's pending approval with
// the sim's canned draft (which "Send offer" then mailed through the real channel), or
// read a real candidate's live offer token for the public /api/offer/<token> door.
//
// resolveSimEntry answers null for a real entry exactly as it does for a missing or
// foreign one, so the route's SIM_ENTRY_NOT_FOUND 404 discloses nothing. The two
// writers below take the RESOLVED entry, never a bare id, so the only way to reach
// them is through the gate. app/api/sim/sim-door-contract.test.ts fails when a sim
// route imports the raw store accessors instead.
import { getPipelineEntry, setApproval } from "@/app/_lib/db/pipeline";
import type { PipelineEntry } from "@/app/_lib/db/core";
import { getOpenOfferForEntry } from "@/app/_lib/offers-store";
import type { ApprovalKind } from "@/app/_lib/approval-kinds";
import { isSimTitle } from "@/app/features/shell/simulation/constants";

declare const SIM_ENTRY: unique symbol;
/** A pipeline entry proven to be (SIM)-marked AND in the caller's team. Only
 *  resolveSimEntry mints one, so a writer that takes it cannot be handed a real row. */
export type SimEntry = PipelineEntry & { readonly [SIM_ENTRY]: true };

/** The entry, if it is in `workspaceId` AND its job title carries the (SIM) marker;
 *  otherwise null — a real entry is indistinguishable from a missing one. */
export function resolveSimEntry(entryId: string, workspaceId: string): SimEntry | null {
  const entry = getPipelineEntry(entryId, workspaceId);
  if (!entry || !isSimTitle(entry.jobTitle)) return null;
  return entry as SimEntry;
}

/** Set the demo approval card on a resolved (SIM) entry, in the entry's own team. */
export function setSimApproval(entry: SimEntry, kind: ApprovalKind, detail: string): boolean {
  return setApproval(entry.id, kind, detail, entry.workspaceId);
}

/** The open offer's capability token for a resolved (SIM) entry, or null. Belt and
 *  braces: the offer row carries its own workspace (inherited at mint), so an offer
 *  that disagrees with the entry is not this caller's to read either. */
export function openSimOfferToken(entry: SimEntry): string | null {
  const offer = getOpenOfferForEntry(entry.id);
  return offer && offer.workspaceId === entry.workspaceId ? offer.token : null;
}
