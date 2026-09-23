// One agenda owner for the Schedule tab (challenge-r02 schedule-calendar-invites/A).
//
// The tab used to hold the invite agenda twice — once in useScheduleTab for the grid,
// once in useScheduleInviteLifecycle for the lifecycle panel it renders as a child —
// and neither copy heard about the other's writes. These cases pin the pure
// write-through module both surfaces now read from, plus two source contracts for the
// behaviours a pure module cannot carry (one GET per mount, live refresh).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  adoptInvite,
  applyMutation,
  calendarEntryIdsOf,
  effectsFor,
  AGENDA_VERBS,
  type AgendaState,
} from "./scheduleAgenda.ts";
import { bookedMarkersFrom } from "./scheduleTabDerived.ts";
import { bucketInvites } from "./scheduleInviteLifecycleBuckets.ts";
import { isoToDateSlot } from "@/app/_lib/schedule-slots";
import type { ScheduleInvite } from "@/app/_lib/schedule-store";
import type { SchedEntry } from "./ScheduleTypes.ts";

const here = dirname(fileURLToPath(import.meta.url));
const NOW = Date.parse("2026-10-01T09:00:00.000Z");
// A weekday, inside the interview grid, after NOW.
const SLOT_AT = "2026-10-06T12:00:00.000Z";
const CELL = isoToDateSlot(SLOT_AT)!;

function invite(over: Partial<ScheduleInvite>): ScheduleInvite {
  return {
    id: over.token ?? "tok",
    token: "tok",
    entryId: null,
    candidateLabel: "Cand",
    status: "pending",
    slot: null,
    slotAt: null,
    needsReconcile: false,
    needsMoreSlots: false,
    proposals: null,
    proposalStatus: null,
    createdAt: new Date(NOW - 3600_000).toISOString(),
    confirmedAt: null,
    entryStatus: null,
    entryStage: null,
    ...over,
  } as ScheduleInvite;
}

function entry(id: string, over: Partial<SchedEntry> = {}): SchedEntry {
  return {
    id,
    candidateId: null,
    candidateLabel: id,
    archetype: null,
    roleFamily: null,
    jobId: null,
    jobTitle: null,
    stage: "scheduling",
    matchScore: null,
    status: "active",
    approvalKind: "calendar",
    approvalDetail: null,
    ...over,
  };
}

test("case 1: adoptInvite replaces in place, appends the unknown, and is identity on nothing", () => {
  const a = invite({ token: "a" });
  const b = invite({ token: "b" });
  const c = invite({ token: "c" });
  const list = [a, b, c];
  const b2 = invite({ token: "b", status: "confirmed", slotAt: SLOT_AT });

  const replaced = adoptInvite(list, b2);
  assert.deepEqual(
    replaced.map((i) => i.token),
    ["a", "b", "c"],
    "order kept"
  );
  assert.equal(replaced[1].status, "confirmed");
  assert.equal(replaced[0], a, "untouched rows keep their identity");
  assert.equal(replaced[2], c, "untouched rows keep their identity");
  assert.notEqual(replaced, list, "a new array, never a mutation of the old one");
  assert.equal(list[1], b, "the input list is not mutated");

  const d = invite({ token: "d" });
  assert.deepEqual(
    adoptInvite(list, d).map((i) => i.token),
    ["a", "b", "c", "d"],
    "an unknown token is appended"
  );

  assert.equal(adoptInvite(list, null), list, "null returns the SAME reference");
  assert.equal(adoptInvite(list, undefined), list, "undefined returns the SAME reference");
});

test("case 1b: a non-joined write response keeps the agenda read's entry join", () => {
  // The mutation routes answer getScheduleInviteByToken (no pipeline join), so their
  // entryStatus/entryStage are null; replacing the joined row wholesale would erase the
  // fate the Closed-row re-invite gates on.
  const joined = invite({ token: "a", entryStatus: "active", entryStage: "interview" });
  const fromWrite = invite({ token: "a", status: "no_show", entryStatus: null, entryStage: null });
  const [out] = adoptInvite([joined], fromWrite);
  assert.equal(out.status, "no_show");
  assert.equal(out.entryStatus, "active");
  assert.equal(out.entryStage, "interview");
});

test("case 2: a grid book drops the card AND draws the booked hour as taken", () => {
  const pendingInv = invite({ token: "t1", entryId: "E" });
  const state: AgendaState = { entries: [entry("E"), entry("F")], invites: [pendingInv] };
  const booked = invite({ token: "t1", entryId: "E", status: "confirmed", slotAt: SLOT_AT });

  const next = applyMutation(state, { kind: "book", entryId: "E", invite: booked });

  assert.deepEqual(
    next.entries?.map((e) => e.id),
    ["F"],
    "E leaves the pending list"
  );
  const markers = bookedMarkersFrom(next.invites, calendarEntryIdsOf(next));
  assert.deepEqual(
    markers.map((m) => m.dateSlot),
    [CELL],
    "the just-booked hour is drawn occupied, not free"
  );
});

test("case 3: accepting a proposal moves the invite to Upcoming and refetches the stale card", () => {
  const proposing = invite({
    token: "t2",
    entryId: "E",
    proposalStatus: "pending",
    proposals: [{ value: SLOT_AT, label: "Tue 6 Oct · 14:00" }],
  });
  const state: AgendaState = { entries: [entry("E")], invites: [proposing] };
  assert.deepEqual(
    bucketInvites(state.invites, NOW).attention.map((i) => i.token),
    ["t2"],
    "fixture: the proposal starts in attention"
  );

  const confirmed = invite({ token: "t2", entryId: "E", status: "confirmed", slotAt: SLOT_AT, proposalStatus: null, proposals: null });
  const next = applyMutation(state, { kind: "accept_proposal", entryId: "E", invite: confirmed });
  const buckets = bucketInvites(next.invites, NOW);
  assert.deepEqual(buckets.attention, [], "the invite leaves attention");
  assert.deepEqual(
    buckets.upcoming.map((i) => i.token),
    ["t2"],
    "and lands in upcoming of the SAME list"
  );
  // The stale pending card carries a Confirm that would now RESCHEDULE the accepted
  // time onto a guessed cell (book reschedules a confirmed invite with no cap). It
  // leaves the list at once, and the entries are re-read from the server.
  assert.deepEqual(next.entries, [], "the stale pending card no longer offers a Confirm");
  assert.deepEqual(effectsFor("accept_proposal"), { refetchEntries: true, notify: true });
});

test("case 4: cancel drops the grid marker and re-buckets to awaiting, from one array", () => {
  const confirmed = invite({ token: "t3", entryId: null, status: "confirmed", slotAt: SLOT_AT });
  const state: AgendaState = { entries: [], invites: [confirmed] };
  assert.equal(bookedMarkersFrom(state.invites, calendarEntryIdsOf(state)).length, 1, "fixture: drawn before");

  const reopened = invite({ token: "t3", entryId: null, status: "pending", slotAt: null });
  const next = applyMutation(state, { kind: "cancel", invite: reopened });

  assert.deepEqual(bookedMarkersFrom(next.invites, calendarEntryIdsOf(next)), [], "the old hour is free again");
  assert.deepEqual(
    bucketInvites(next.invites, NOW).awaiting.map((i) => i.token),
    ["t3"],
    "the panel's awaiting bucket reads the same array"
  );
  assert.equal(next.invites.length, 1, "no second copy of the invite");
});

test("case 5: effectsFor is total over the recruiter verbs", () => {
  const refetch = new Set(["book", "accept_proposal"]);
  for (const kind of ["book", "accept_proposal", "cancel", "no_show", "decline_proposals", "resolve_reconcile", "reinvite", "meeting_url"] as const) {
    assert.ok(AGENDA_VERBS.includes(kind), `${kind} is a declared verb`);
    const fx = effectsFor(kind);
    assert.equal(fx.refetchEntries, refetch.has(kind), `${kind}.refetchEntries`);
    assert.equal(fx.notify, kind !== "meeting_url", `${kind}.notify`);
  }
  for (const kind of AGENDA_VERBS) {
    const fx = effectsFor(kind);
    assert.equal(typeof fx.refetchEntries, "boolean", `${kind} has an answer`);
    assert.equal(typeof fx.notify, "boolean", `${kind} has an answer`);
  }
});

test("case 5b: a meeting-link patch merges into its row and touches nothing else", () => {
  const a = invite({ token: "a", status: "confirmed", slotAt: SLOT_AT });
  const b = invite({ token: "b" });
  const state: AgendaState = { entries: [entry("E")], invites: [a, b] };
  const next = applyMutation(state, { kind: "meeting_url", token: "a", patch: { meetingUrl: "https://meet.example/x" } });
  assert.equal(next.invites[0].meetingUrl, "https://meet.example/x");
  assert.equal(next.invites[0].status, "confirmed");
  assert.equal(next.invites[1], b);
  assert.equal(next.entries, state.entries, "entries keep their identity");
});

test("case 6 (source contract): the lifecycle panel no longer fetches its own agenda", () => {
  const src = readFileSync(join(here, "useScheduleInviteLifecycle.ts"), "utf8");
  assert.doesNotMatch(src, /sharedGetJson/, "no shared-GET import or call");
  assert.doesNotMatch(src, /["'`]\/api\/schedule["'`]/, "no GET /api/schedule of its own");
  const owner = readFileSync(join(here, "useScheduleTab.ts"), "utf8");
  const reads = owner.match(/["'`]\/api\/schedule["'`]/g) ?? [];
  assert.ok(reads.length >= 1, "the owner reads the agenda");
  const panel = readFileSync(join(here, "ScheduleInviteLifecyclePanel.tsx"), "utf8");
  assert.match(panel, /agenda/, "the panel receives the agenda from its owner");
});

test("case 7 (source contract): the owner subscribes to the live-refresh bus and announces its writes", () => {
  const owner = readFileSync(join(here, "useScheduleTab.ts"), "utf8");
  assert.match(owner, /useLiveRefresh\(/, "a change elsewhere reloads the agenda");
  assert.match(owner, /notifyDataChanged\(/, "a Schedule write refreshes the board and Decisions");
  assert.match(owner, /effectsFor\(/, "the effects come from the one declared table");
  // The guided simulation still clicks the pending card's Confirm.
  const list = readFileSync(join(here, "ScheduleTabPendingList.tsx"), "utf8");
  assert.match(list, /data-sim-click="confirm"/);
});
