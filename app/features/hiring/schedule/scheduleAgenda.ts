// The Schedule tab's ONE agenda: the pending pipeline entries the grid places and the
// invite list both the grid (booked markers, seeds) and the lifecycle panel
// (attention / upcoming / awaiting / closed) read from.
//
// Why this module exists (challenge-r02 schedule-calendar-invites/A). The tab used to
// hold the agenda twice — useScheduleTab for the grid, useScheduleInviteLifecycle for
// the panel it renders as a CHILD — and neither copy heard about the other's writes.
// A grid Confirm booked server-side and dropped the card without adopting the returned
// invite, so the booked hour was drawn free; accepting a candidate's proposal in the
// panel advanced the entry server-side while the grid kept the pending card, whose
// Confirm would then RESCHEDULE the accepted time onto the card's guessed cell (the
// `book` route moves a confirmed invite with recruiter authority, no cap).
//
// The invalidation hierarchy this implements (client-state / invalidation-strategy):
//   rung 1 — write-through: every recruiter verb adopts the row its route answers,
//            via applyMutation, so both surfaces move in the same render;
//   rung 2 — the live-refresh bus (useLiveRefresh in the owner) for changes made
//            elsewhere, and notifyDataChanged so OTHER views hear about ours;
//   refetch — only where the write changes server state the response does not carry
//            (effectsFor(kind).refetchEntries: book/accept_proposal advance the entry).
//
// Pure and data-only: no React, no fetch, and ScheduleInvite is type-only so
// better-sqlite3 stays out of the client bundle. Extending it (slot B's pending-card
// states): add a verb to AGENDA_VERBS, give it a row in EFFECTS (the table is typed
// total, so tsc refuses a verb with no answer), and a branch in applyMutation only if
// the write moves more than the one invite row.

import type { ScheduleInvite } from "@/app/_lib/schedule-store";
import type { SchedEntry } from "./ScheduleTypes";

/** Every recruiter write the Schedule tab makes. `book` and `reject` are the grid's
 *  card actions (Confirm / Decline); the rest are the lifecycle panel's invite verbs. */
export const AGENDA_VERBS = [
  "book",
  "reject",
  "accept_proposal",
  "cancel",
  "no_show",
  "decline_proposals",
  "resolve_reconcile",
  "reinvite",
  "meeting_url",
] as const;
export type AgendaVerb = (typeof AGENDA_VERBS)[number];

export function isAgendaVerb(v: unknown): v is AgendaVerb {
  return typeof v === "string" && (AGENDA_VERBS as readonly string[]).includes(v);
}

/** The panel's invite verbs — the ones POSTed to /api/schedule as `{token, action}`. */
export type InviteActionVerb = Extract<
  AgendaVerb,
  "accept_proposal" | "cancel" | "no_show" | "decline_proposals" | "resolve_reconcile"
>;
const INVITE_ACTION_VERBS: readonly InviteActionVerb[] = [
  "accept_proposal",
  "cancel",
  "no_show",
  "decline_proposals",
  "resolve_reconcile",
];
export function isInviteActionVerb(v: unknown): v is InviteActionVerb {
  return typeof v === "string" && (INVITE_ACTION_VERBS as readonly string[]).includes(v);
}

export type AgendaState = {
  /** Pending pipeline entries on the Schedule tab; null until the first load lands. */
  entries: SchedEntry[] | null;
  /** The invite agenda (GET /api/schedule), the ONE list both surfaces read. */
  invites: ScheduleInvite[];
};

export type AgendaMutation =
  | {
      kind: Exclude<AgendaVerb, "meeting_url">;
      /** The pipeline entry the write acted on, when it drops a pending card. */
      entryId?: string | null;
      /** The invite row the route answered; null/absent when it answered none. */
      invite?: ScheduleInvite | null;
    }
  | {
      kind: "meeting_url";
      token: string;
      /** The meeting-link PATCH may answer a partial row (`{meetingUrl: null}`). */
      patch: Partial<ScheduleInvite>;
    };

export type AgendaEffects = {
  /** Re-read /api/pipeline (+ the agenda): the write moved an entry server-side in a
   *  way its response does not describe (stage advanced, approval cleared). */
  refetchEntries: boolean;
  /** Announce on the live-refresh bus so the Pipeline board and Decisions reload. */
  notify: boolean;
};

// Typed total over AgendaVerb: a verb added above without a row here fails tsc.
const EFFECTS: Record<AgendaVerb, AgendaEffects> = {
  // Both advance the linked pipeline entry (approve_event) server-side.
  book: { refetchEntries: true, notify: true },
  accept_proposal: { refetchEntries: true, notify: true },
  // Terminal reject on the entry; the card is dropped by applyMutation.
  reject: { refetchEntries: false, notify: true },
  // Invite-only writes whose response row is the whole change.
  cancel: { refetchEntries: false, notify: true },
  no_show: { refetchEntries: false, notify: true },
  decline_proposals: { refetchEntries: false, notify: true },
  resolve_reconcile: { refetchEntries: false, notify: true },
  // Mints a new pending invite; the route answers a token, not a row, so the OWNER
  // re-reads the agenda (a mutation with no invite to adopt) — the entry is unchanged.
  reinvite: { refetchEntries: false, notify: true },
  // A join link on the invite: nothing another view renders.
  meeting_url: { refetchEntries: false, notify: false },
};

export function effectsFor(kind: AgendaVerb): AgendaEffects {
  return EFFECTS[kind];
}

/** The ids drawn as assignable chips on the grid (bookedMarkersFrom's exclusion set). */
export function calendarEntryIdsOf(state: Pick<AgendaState, "entries">): Set<string> {
  return new Set((state.entries ?? []).filter((e) => e.approvalKind === "calendar").map((e) => e.id));
}

/** Adopt one invite row a write answered: replaced in place by token (order kept,
 *  every other row keeps its identity so memoized children do not re-render), or
 *  appended when the agenda has not seen it. Nothing to adopt → the SAME array.
 *
 *  The write routes answer `getScheduleInviteByToken`, which does not join the
 *  pipeline entry, so their entryStatus/entryStage are null. The agenda read's join
 *  is kept in that case — it is what the Closed-row re-invite gates on. */
export function adoptInvite(
  invites: readonly ScheduleInvite[],
  inv: ScheduleInvite | null | undefined
): ScheduleInvite[] {
  if (!inv) return invites as ScheduleInvite[];
  const at = invites.findIndex((i) => i.token === inv.token);
  if (at === -1) return [...invites, inv];
  const prev = invites[at];
  const merged: ScheduleInvite = {
    ...inv,
    entryStatus: inv.entryStatus ?? prev.entryStatus,
    entryStage: inv.entryStage ?? prev.entryStage,
  };
  const out = invites.slice();
  out[at] = merged;
  return out;
}

/** Merge a partial write answer into one known row. Unknown token → the SAME array
 *  (a partial row is not a row to append). */
export function patchInvite(
  invites: readonly ScheduleInvite[],
  token: string,
  patch: Partial<ScheduleInvite>
): ScheduleInvite[] {
  const at = invites.findIndex((i) => i.token === token);
  if (at === -1) return invites as ScheduleInvite[];
  const out = invites.slice();
  out[at] = { ...invites[at], ...patch, token };
  return out;
}

function dropEntry(entries: SchedEntry[] | null, entryId: string | null | undefined): SchedEntry[] | null {
  if (!entries || !entryId) return entries;
  return entries.some((e) => e.id === entryId) ? entries.filter((e) => e.id !== entryId) : entries;
}

/** Apply one recruiter write to the agenda — the write-through half of the owner.
 *  Returns a new state (or the same one when nothing moved). */
export function applyMutation(state: AgendaState, m: AgendaMutation): AgendaState {
  if (m.kind === "meeting_url") {
    const invites = patchInvite(state.invites, m.token, m.patch);
    return invites === state.invites ? state : { ...state, invites };
  }
  const invites = adoptInvite(state.invites, m.invite);
  let entries = state.entries;
  switch (m.kind) {
    case "book":
    case "reject":
      // The card's own action: it leaves the pending list (the tab animates it out).
      entries = dropEntry(entries, m.entryId);
      break;
    case "accept_proposal":
      // The accept advanced the entry server-side (approval cleared). Its pending card
      // must not linger offering a Confirm that would reschedule the accepted time
      // onto a guessed cell; effectsFor says re-read the entries to settle the rest.
      entries = dropEntry(entries, m.entryId ?? m.invite?.entryId ?? null);
      break;
    default:
      break;
  }
  if (invites === state.invites && entries === state.entries) return state;
  return { ...state, invites, entries };
}

/** A write's answer as the owner hands it back to the panel: `body` is the parsed
 *  route response, so a refusal resolves from its machine code in the reader's
 *  language (useErrorMessage) and a re-invite's truthful `delivery` claim is read. */
export type AgendaWriteResult = { ok: boolean; body: Record<string, unknown> };

/** What the owner hands the lifecycle panel: the SAME invite list the grid reads
 *  (null while the first read is in flight), and the owner's writers. The panel keeps
 *  only its own interaction latches (armed / busy) and its toasts. */
export type ScheduleAgendaView = {
  invites: ScheduleInvite[] | null;
  loadedAt: number;
  truncated: boolean;
  failed: boolean;
  runInviteAction: (token: string, action: InviteActionVerb, slotAt?: string) => Promise<AgendaWriteResult>;
  reinviteEntry: (entryId: string) => Promise<AgendaWriteResult>;
  adoptMeetingPatch: (token: string, patch: Partial<ScheduleInvite>) => void;
};

/** A live-refresh signal this window raised itself arrives back through the same
 *  bus (the window event; a BroadcastChannel never echoes its own posts). The owner
 *  has already written through and, where effectsFor asks, re-read — so a signal
 *  inside this window of its own notify is its echo, not news. Sized to cover the
 *  bus's 250ms debounce with margin. */
export const OWN_ECHO_WINDOW_MS = 1000;
export function isOwnEcho(lastOwnNotifyAt: number, nowMs: number): boolean {
  return lastOwnNotifyAt > 0 && nowMs - lastOwnNotifyAt >= 0 && nowMs - lastOwnNotifyAt < OWN_ECHO_WINDOW_MS;
}
