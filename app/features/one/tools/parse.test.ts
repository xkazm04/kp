// The round-4 tools' parsers: each folds what its route returns and refuses what it does not
// (an unknown body is an error upstream, never "nothing here"), and the calendar arithmetic
// files interviews and free slots under the interview zone's own calendar day.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupByRole,
  letterNextAct,
  parseBookingConfirmation,
  parseBookingForecast,
  parseInvites,
  parseLetter,
  letterMatches,
  parseLettersList,
  parseProfile,
  parseSlots,
  parseThread,
  parseTimelineAnalysis,
  profileSlug,
  suggestBooking,
  waitingForInterview,
  weekDays,
} from "./parse.ts";
import { parsePipeline } from "../panels/pipelineRead.ts";

test("the letters queue keeps well-formed rows and refuses an unknown body", () => {
  assert.equal(parseLettersList(null), null);
  assert.equal(parseLettersList({ error: "x" }), null);
  const r = parseLettersList({
    letters: [
      { id: "ol-1", entryId: "pe-1", candidateLabel: "Ana", jobTitle: "Backend", subject: "Hi", state: "drafted", revision: 2, createdAt: "2026-11-01T00:00:00Z" },
      { id: "ol-2", entryId: "pe-2", state: "nonsense", revision: 1, createdAt: "2026-11-01T00:00:00Z" },
      { id: "ol-3", state: "drafted" },
    ],
    truncated: true,
  });
  assert.ok(r);
  assert.deepEqual(r.letters.map((l) => l.id), ["ol-1"]);
  assert.equal(r.letters[0].revision, 2);
  assert.equal(r.truncated, true);
});

test("a held letter reads with its preview; none held is a real answer; the next act follows the state", () => {
  assert.deepEqual(parseLetter({ letter: null, preview: null }), { letter: null, preview: null });
  assert.equal(parseLetter({ messages: [] }), null);
  const r = parseLetter({
    letter: { id: "ol-1", entryId: "pe-1", state: "drafted", revision: 3, subject: "A role", body: "Dear Ana", lang: "en", createdAt: "a", updatedAt: "b" },
    preview: { subject: "A role", body: "Dear Ana\n--\nfooter", recipient: "ana@example.cz", forecast: "local", forecastReason: null },
  });
  assert.ok(r?.letter && r.preview);
  assert.equal(r.letter.revision, 3);
  assert.equal(r.preview.forecast, "local");
  assert.equal(letterNextAct(r.letter), "approve");
  assert.equal(letterNextAct({ ...r.letter, state: "approved" }), "send");
  assert.equal(letterNextAct({ ...r.letter, state: "delivery_failed" }), "send");
  assert.equal(letterNextAct({ ...r.letter, state: "released" }), null);
  assert.equal(letterNextAct({ ...r.letter, body: null }), null, "an erased letter offers nothing");
});

test("the thread carries the one delivery verdict per message", () => {
  const r = parseThread({ messages: [{ id: "m1", status: "queued", subject: "Hi", createdAt: "2026-11-01T00:00:00Z", kind: "outreach" }, { id: "bad" }], relayConfigured: false });
  assert.ok(r);
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].verdict, "queued");
  assert.equal(r.relayConfigured, false);
});

test("the profile link prefers the confirmed analysis, then falls back to the seeded one", () => {
  const link = parseTimelineAnalysis({
    items: [
      { kind: "invite", at: "2026-10-01" },
      { kind: "analysis", slug: "by-name", labelOnly: true, at: "2026-10-05" },
      { kind: "analysis", slug: "by-job", labelOnly: false, at: "2026-09-01" },
    ],
  });
  assert.deepEqual(link, { slug: "by-job", labelOnly: false });
  assert.deepEqual(parseTimelineAnalysis({ items: [] }), { slug: null });
  assert.equal(parseTimelineAnalysis({}), null);
  assert.deepEqual(profileSlug({ slug: null }, "cand-7"), { slug: "seed-cand-7", labelOnly: false, source: "seed" });
  assert.equal(profileSlug({ slug: null }, null), null);
});

test("the profile summary reads the CV text, the verdict and the five parts with their maxima", () => {
  assert.equal(parseProfile({ slug: "x" }), null, "no analysis payload is not a profile");
  const p = parseProfile({
    slug: "seed-cand-1",
    candidateLabel: "Ana",
    engine: "deterministic",
    createdAt: "2024-01-01T00:00:00Z",
    analysis: {
      candidate: { rawText: "Ana\nBackend", skills: ["Go", ""] },
      score: { total: 70, experience: 20, skills: 22, roleSeniority: 15, education: 8, traits: 5 },
      jobFit: { score: 64, summary: "Solid", matchingSkills: ["Go"], missingSkills: ["K8s"], unprovenSkills: null },
      strengths: ["Ships"],
      gaps: ["No cloud"],
      softSignals: { strengths: [{ key: "k", label: "Owner", detail: "d" }], antipatterns: [{ key: "j", label: "Hops", detail: "d" }], summary: "" },
    },
  });
  assert.ok(p);
  assert.equal(p.cvText, "Ana\nBackend");
  assert.equal(p.verdict.overall, 70, "the reconciled component sum");
  assert.equal(p.verdict.tone, "mid");
  assert.deepEqual(p.parts.map((x) => [x.key, x.value, x.max]), [["experience", 20, 25], ["skills", 22, 30], ["roleSeniority", 15, 23], ["education", 8, 12], ["traits", 5, 10]]);
  assert.deepEqual(p.jobFit?.missing, ["K8s"]);
  assert.deepEqual(p.jobFit?.unproven, []);
  assert.deepEqual(p.softSignals.map((s) => s.side), ["strength", "watch"]);
  assert.deepEqual(p.skills, ["Go"]);
});

test("invites and slots parse; a pending invite with no time stays off the grid", () => {
  assert.equal(parseInvites({}), null);
  assert.equal(parseSlots({}), null);
  const inv = parseInvites({
    interviewTz: "Europe/Prague",
    truncated: false,
    invites: [
      { id: "i1", entryId: "pe-1", candidateLabel: "Ana", status: "confirmed", slotAt: "2026-11-10T09:00:00.000Z", durationMin: 45 },
      { id: "i2", entryId: "pe-2", candidateLabel: "Ben", status: "pending", slotAt: null },
      { id: "i3", entryId: "pe-3", status: "declined", slotAt: "2026-11-10T13:00:00.000Z" },
      { id: "i4", status: "weird" },
    ],
  });
  assert.ok(inv);
  assert.deepEqual(inv.invites.map((i) => i.id), ["i1", "i2", "i3"]);
  const slots = parseSlots({ slots: [{ value: "2026-11-10T13:00:00.000Z", label: "Tue 10 Nov · 14:00" }, { value: "x", label: "y" }], calendarStatus: "not_connected" });
  assert.ok(slots);
  assert.equal(slots.slots.length, 1);
  const week = [9, 10, 11, 12, 13].map((d, i) => ({ iso: `2026-11-${String(d).padStart(2, "0")}`, year: 2026, month: 11, day: d, weekday: i + 1, past: false }));
  const days = weekDays(week, inv.invites, slots.slots, "Europe/Prague");
  const tue = days[1];
  assert.deepEqual(
    tue.items.map((x) => [x.kind, x.time]),
    [["interview", "10:00"], ["free", "14:00"]],
    "Prague wall clock; the declined one is not drawn"
  );
  const free = tue.items[1];
  assert.equal(free.kind === "free" ? free.dateSlot : null, "2026-11-10 14:00", "the book door's dateSlot");
});

test("waiting = the calendar gate, longest first, grouped by role in first-row order; one suggested booking", () => {
  const read = parsePipeline({
    entries: [
      { id: "a", candidateLabel: "Ana", jobTitle: "Backend", stage: "Screened", status: "active", approvalKind: "calendar", stageChangedAt: "2026-11-05T00:00:00Z" },
      { id: "b", candidateLabel: "Ben", jobTitle: "Design", stage: "Screened", status: "active", approvalKind: "calendar", stageChangedAt: "2026-11-01T00:00:00Z" },
      { id: "c", candidateLabel: "Cy", jobTitle: "Backend", stage: "Screened", status: "active", approvalKind: "calendar", stageChangedAt: "2026-11-02T00:00:00Z" },
      { id: "d", candidateLabel: "Di", jobTitle: "Backend", stage: "Screened", status: "active", approvalKind: "decision" },
    ],
  });
  assert.ok(read);
  const waiting = waitingForInterview(read.entries);
  assert.deepEqual(waiting.map((e) => e.id), ["b", "c", "a"]);
  assert.deepEqual(groupByRole(waiting, (e) => e.jobTitle).map((g) => [g.role, g.rows.map((r) => r.id)]), [["Design", ["b"]], ["Backend", ["c", "a"]]]);
  const s = suggestBooking(waiting, [{ value: "2026-11-10T09:00:00.000Z", label: "Tue 10 Nov · 10:00" }], "Europe/Prague");
  assert.equal(s?.entry.id, "b");
  assert.equal(s?.dateSlot, "2026-11-10 10:00");
  assert.equal(suggestBooking([], [], "Europe/Prague"), null);
});

test("waiting longest puts a known date first and an unknown one last (locale collation does not)", () => {
  const mk = (id: string, at: string | null) => ({ id, stageChangedAt: at, waitingInterview: true }) as unknown as Parameters<typeof waitingForInterview>[0][number];
  const order = waitingForInterview([mk("none", null), mk("new", "2026-11-01T00:00:00Z"), mk("old", "2026-05-01T00:00:00Z")]).map((e) => e.id);
  assert.deepEqual(order, ["old", "new", "none"]);
});

test("a letter consent card matches only the letter, revision and state it was armed for", () => {
  const l = { id: "ol-1", entryId: "pe-1", state: "drafted" as const, revision: 2, subject: "s", body: "b", lang: "cs", approvedAt: null, releasedAt: null, createdAt: "", updatedAt: "" };
  const approve = { act: "letterApprove" as const, letterId: "ol-1", revision: 2 };
  assert.equal(letterMatches(approve, l), true);
  assert.equal(letterMatches({ ...approve, revision: 1 }, l), false, "redrafted since the card was armed");
  assert.equal(letterMatches({ ...approve, letterId: "ol-2" }, l), false);
  assert.equal(letterMatches(approve, { ...l, state: "approved" }), false, "already approved");
  assert.equal(letterMatches(approve, { ...l, body: null }), false, "erased text");
  assert.equal(letterMatches(approve, null), false);
  const send = { act: "letterSend" as const, letterId: "ol-1", revision: null };
  assert.equal(letterMatches(send, l), false, "a draft is not sendable");
  assert.equal(letterMatches(send, { ...l, state: "approved" }), true);
  assert.equal(letterMatches(send, { ...l, state: "delivery_failed" }), true);
  assert.equal(letterMatches(send, { ...l, state: "released" }), false);
});

test("a booking's confirmation: the forecast and the claim keep the closed vocabulary", () => {
  assert.deepEqual(parseBookingForecast({ confirmation: { recipient: "ana@example.com", forecast: "local", reason: null } }), {
    forecast: "local",
    recipient: "ana@example.com",
    reason: null,
  });
  assert.deepEqual(parseBookingForecast({ confirmation: { recipient: null, forecast: "withheld", reason: "suppressed" } }), {
    forecast: "withheld",
    recipient: null,
    reason: "suppressed",
  });
  // A withheld forecast with no known reason, or an unknown forecast, is not a reading.
  assert.equal(parseBookingForecast({ confirmation: { forecast: "withheld", reason: "maybe" } }), null);
  assert.equal(parseBookingForecast({ confirmation: { forecast: "delivered" } }), null);
  assert.equal(parseBookingForecast({}), null);

  assert.deepEqual(parseBookingConfirmation({ delivery: "queued", reason: null }), { delivery: "queued", reason: null });
  assert.deepEqual(parseBookingConfirmation({ delivery: "withheld", reason: "unaddressable" }), { delivery: "withheld", reason: "unaddressable" });
  // An older server says nothing: no line, never a guessed "sent".
  assert.equal(parseBookingConfirmation(undefined), null);
  assert.equal(parseBookingConfirmation({ delivery: "delivered" }), null);
});
