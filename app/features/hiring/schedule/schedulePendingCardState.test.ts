// Pending cards act on the invite's real state (challenge-r02 schedule-calendar-invites/B).
//
// Every pending card on the Schedule tab used to offer one booking action, Confirm,
// and it booked whatever cell was seeded, including the flat "Tue 14:00" guess for a
// candidate nobody had asked. These cases pin the pure resolver that joins each card
// to its candidate's live invite and names the next real step, plus a source contract
// that the guided simulation's book click still resolves on every card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bookControlFor,
  liveInviteFor,
  pendingCardState,
  sendLinkNotice,
  PENDING_CARD_KINDS,
} from "./schedulePendingCardState.ts";
import { AGENDA_VERBS, effectsFor } from "./scheduleAgenda.ts";
import type { ScheduleInvite } from "@/app/_lib/schedule-store";
import type { SchedEntry } from "./ScheduleTypes.ts";

const here = dirname(fileURLToPath(import.meta.url));
const NOW = Date.parse("2026-10-01T09:00:00.000Z");
const HOUR = 3600_000;
const SLOT_AT = "2026-10-06T12:00:00.000Z";

function invite(over: Partial<ScheduleInvite>): ScheduleInvite {
  return {
    id: over.token ?? "tok",
    token: "tok",
    entryId: "E",
    candidateLabel: "Cand",
    status: "pending",
    slot: null,
    slotAt: null,
    needsReconcile: false,
    needsMoreSlots: false,
    proposals: null,
    proposalStatus: null,
    attendanceStatus: null,
    attendanceAt: null,
    createdAt: new Date(NOW - HOUR).toISOString(),
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

const ago = (h: number) => new Date(NOW - h * HOUR).toISOString();

test("case 1: liveInviteFor picks deliberately, independent of list order", () => {
  const confirmed = invite({ token: "c", status: "confirmed", slotAt: SLOT_AT, createdAt: ago(48) });
  const declined = invite({ token: "d", status: "declined", createdAt: ago(1) });
  assert.equal(liveInviteFor("E", [confirmed, declined], NOW)?.token, "c");
  assert.equal(liveInviteFor("E", [declined, confirmed], NOW)?.token, "c", "order does not decide");

  const pending = invite({ token: "p", status: "pending", createdAt: ago(10) });
  const newestDeclined = invite({ token: "d2", status: "declined", createdAt: ago(1) });
  assert.equal(liveInviteFor("E", [newestDeclined, pending], NOW)?.token, "p");
  assert.equal(liveInviteFor("E", [pending, newestDeclined], NOW)?.token, "p");

  const oldClosed = invite({ token: "n1", status: "no_show", createdAt: ago(300) });
  const newClosed = invite({ token: "n2", status: "declined", createdAt: ago(200) });
  assert.equal(liveInviteFor("E", [newClosed, oldClosed], NOW)?.token, "n2", "closed-only -> most recent");
  assert.equal(liveInviteFor("E", [oldClosed, newClosed], NOW)?.token, "n2");

  const other = invite({ token: "x", entryId: "OTHER", status: "confirmed", slotAt: SLOT_AT });
  assert.equal(liveInviteFor("E", [other], NOW), null, "none for E -> null");
  assert.equal(liveInviteFor("E", [], NOW), null);
});

test("case 2: no invite and a flat default cell -> send the link first, booking is secondary", () => {
  const s = pendingCardState(entry("E"), null, "guess", NOW);
  assert.equal(s.kind, "no_link");
  assert.equal(s.primary, "send_link");
  assert.equal(s.bookSuggested, true);
  // The legacy detail is still a suggestion, never a booking.
  assert.equal(pendingCardState(entry("E"), null, "legacy", NOW).primary, "send_link");
});

test("case 3: a sent link shows its age; an expired one offers a fresh link", () => {
  const inv = invite({ token: "p", createdAt: ago(50) });
  const s = pendingCardState(entry("E"), inv, "guess", NOW);
  assert.equal(s.kind, "awaiting");
  assert.equal(s.sentAt, inv.createdAt);
  assert.equal(s.primary, "copy_link");
  assert.equal(s.token, "p");
  assert.equal(s.bookSuggested, true);

  const stale = invite({ token: "p", createdAt: ago(24 * 60) });
  const x = pendingCardState(entry("E"), stale, "guess", NOW);
  assert.equal(x.kind, "expired");
  assert.equal(x.primary, "reinvite");
});

test("case 4: candidate proposals are answered on the card", () => {
  const a = { value: "2026-10-07T08:00:00.000Z", label: "Wed 10:00" };
  const b = { value: "2026-10-08T12:00:00.000Z", label: "Thu 14:00" };
  const inv = invite({ token: "p", proposalStatus: "pending", proposals: [a, b] });
  const s = pendingCardState(entry("E"), inv, "guess", NOW);
  assert.equal(s.kind, "proposals");
  assert.deepEqual(s.proposals, [a, b]);
  assert.equal(s.primary, "accept_proposal");
  assert.equal(s.token, "p", "the accept POSTs this token");
  // accept_proposal is the lifecycle panel's existing verb: it re-reads the pipeline
  // and drops the card (scheduleAgenda.ts).
  assert.deepEqual(effectsFor("accept_proposal"), { refetchEntries: true, notify: true });
  // The accept control POSTs {action:'accept_proposal', token, slotAt: proposal.value}.
  const list = readFileSync(join(here, "ScheduleTabPendingList.tsx"), "utf8");
  assert.match(list, /onAcceptProposal\(e, state\.token, p\.value\)/);
  const owner = readFileSync(join(here, "useScheduleTab.ts"), "utf8");
  assert.match(owner, /runInviteAction\(token, "accept_proposal", slotAt\)/);
});

test("case 5: a stalled candidate points at the attention row, never a primary Confirm", () => {
  const inv = invite({ token: "p", needsMoreSlots: true });
  const s = pendingCardState(entry("E"), inv, "guess", NOW);
  assert.equal(s.kind, "stuck_no_slots");
  assert.notEqual(s.primary, "confirm");
  assert.equal(s.primary, "see_attention");
  assert.equal(bookControlFor(s).emphasis, "secondary");
});

test("case 6: Confirm is primary ONLY for a cell a confirmed invite backs", () => {
  const inv = invite({ token: "c", status: "confirmed", slotAt: SLOT_AT });
  const s = pendingCardState(entry("E"), inv, "booked", NOW);
  assert.equal(s.kind, "booked");
  assert.equal(s.primary, "confirm");
  assert.equal(s.bookSuggested, false);
  assert.deepEqual(bookControlFor(s), { label: "confirm", emphasis: "primary" });
  for (const kind of PENDING_CARD_KINDS) {
    if (kind === "booked") continue;
    const fixture: Record<string, [ScheduleInvite | null, "booked" | "legacy" | "guess"]> = {
      no_link: [null, "guess"],
      awaiting: [invite({}), "guess"],
      expired: [invite({ createdAt: ago(24 * 60) }), "guess"],
      closed: [invite({ status: "declined" }), "guess"],
      proposals: [invite({ proposalStatus: "pending", proposals: [{ value: SLOT_AT, label: "x" }] }), "guess"],
      stuck_no_slots: [invite({ needsMoreSlots: true }), "guess"],
    };
    const [inv2, src] = fixture[kind];
    const st = pendingCardState(entry("E"), inv2, src, NOW);
    assert.equal(st.kind, kind);
    assert.notEqual(st.primary, "confirm", `${kind} does not put Confirm first`);
    assert.deepEqual(bookControlFor(st), { label: "bookSuggested", emphasis: "secondary" }, kind);
  }
});

test("case 7: the send-link notice is the route's truthful delivery claim", () => {
  assert.deepEqual(sendLinkNotice({ delivery: "sent" }), { key: "sendLink.sent", variant: "success" });
  assert.deepEqual(sendLinkNotice({ delivery: "queued" }), { key: "sendLink.queued", variant: "info" });
  assert.deepEqual(sendLinkNotice({ delivery: "failed" }), { key: "sendLink.failed", variant: "error" });
  // No claim is never read as a delivery.
  assert.equal(sendLinkNotice({}).key, "sendLink.failed");
  // send_link is a declared agenda verb: the agenda re-reads (the route answers a
  // token, not a row) and the board hears about it.
  assert.ok((AGENDA_VERBS as readonly string[]).includes("send_link"));
  assert.deepEqual(effectsFor("send_link"), { refetchEntries: false, notify: true });
  for (const loc of ["en", "cs", "de", "fr"]) {
    const cat = JSON.parse(readFileSync(join(here, "../../../../messages", `${loc}.json`), "utf8"));
    for (const k of ["sent", "queued", "failed", "action", "refused"]) {
      assert.equal(typeof cat.scheduleTab?.sendLink?.[k], "string", `${loc} scheduleTab.sendLink.${k}`);
    }
    for (const k of ["noLink", "awaiting", "expired", "declined", "noShow", "proposals", "stuck", "copyLink", "linkCopied", "copyFailed", "reinvite", "bookSuggested", "bookSuggestedTitle"]) {
      assert.equal(typeof cat.scheduleTab?.cardState?.[k], "string", `${loc} scheduleTab.cardState.${k}`);
    }
  }
});

test("case 8 (source contract): every non-booked card keeps the simulation's book control", () => {
  const list = readFileSync(join(here, "ScheduleTabPendingList.tsx"), "utf8");
  const clicks = list.match(/data-sim-click="confirm"/g) ?? [];
  assert.equal(clicks.length, 1, "one book control, rendered for every kind");
  assert.ok(list.indexOf("data-sim-entry") < list.indexOf('data-sim-click="confirm"'), "inside the card");
  assert.match(list, /bookControlFor\(state\)/, "its label and emphasis come from the resolver, not a kind gate");
});
