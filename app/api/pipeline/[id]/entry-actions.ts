// The single-entry door's declared actions (challenge-r07 pipeline-api/A).
//
// POST /api/pipeline/[id] dispatches eight actions. Each one's REQUIREMENTS are data
// here, beside the operation, and the route reads them through one gate — so an action
// the door dispatches without a declared seat is unrepresentable (the route narrows
// body.action through entryActionOf before it does anything else), and adding a row
// without a capability is a type error.
//
// Three facts per action:
//   • capability — the seat it asks (requireCapabilityCoded). Every row is a board
//     write, so every row asks pipeline:write: a viewer reads the board, never moves it.
//   • engineClaim — may the body declare the ENGINE (actor: "sim")? Only accept: the
//     guided simulation's two senders (useSimulationEngine / useSimulationWalk) send it
//     on accept and nowhere else. On any other action the claim is dropped at the door,
//     because on a reject it would file a recruiter's decision as a machine
//     auto-rejection (kind auto_rejected, sealed "auto:sim") and route it into the
//     Reconsider queue.
//   • reverses — what the action may undo. Only reinstate, and only an auto-rejection:
//     its sealed record says "Auto-rejection reversed", so it must never be written over
//     a recruiter's hand reject. The rule itself (newest decision is auto_rejected) is
//     newestDecisionIsAutoRejection in app/_lib/db/pipeline.ts, shared with the
//     Reconsider queue so the queue never lists what the door refuses.
//
// Pure and import-free at runtime (the Capability import is type-only), so node:test
// reads the table directly and the route's import graph gains ~nothing.
import type { Capability } from "@/app/_lib/auth/roles";

export type EntryActionSpec = {
  readonly capability: Capability;
  readonly engineClaim: boolean;
  readonly reverses: "auto_rejected" | null;
};

const WRITE = { capability: "pipeline:write", engineClaim: false, reverses: null } as const;

export const ENTRY_ACTIONS = {
  set_github: WRITE,
  set_notes: WRITE,
  reinstate: { capability: "pipeline:write", engineClaim: false, reverses: "auto_rejected" },
  resolve_intake: WRITE,
  set_stage: WRITE,
  accept: { capability: "pipeline:write", engineClaim: true, reverses: null },
  reject: WRITE,
  approve_event: WRITE,
} as const satisfies Record<string, EntryActionSpec>;

export type EntryActionName = keyof typeof ENTRY_ACTIONS;

export const ENTRY_ACTION_NAMES = Object.keys(ENTRY_ACTIONS) as readonly EntryActionName[];

/** The action named by an untrusted body, or null when the door does not dispatch it.
 *  Own-property check, so `toString` / `__proto__` are not actions. */
export function entryActionOf(raw: unknown): EntryActionName | null {
  return typeof raw === "string" && Object.prototype.hasOwnProperty.call(ENTRY_ACTIONS, raw) ? (raw as EntryActionName) : null;
}

/** The body's `actor` claim as the door forwards it: kept only where the action declares
 *  an engine claim, dropped (undefined ⇒ the session's human) everywhere else. */
export function engineClaimOf(action: EntryActionName, actor: unknown): unknown {
  return ENTRY_ACTIONS[action].engineClaim ? actor : undefined;
}
