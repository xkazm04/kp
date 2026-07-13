// Pins the client-side calendar builders (Solution Ⓑ): the wire formats Google and
// Outlook expect, and a well-formed, deterministic .ics. Regressions here silently
// produce calendar links that open a blank/garbled event.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidateCalendarEvent,
  DEFAULT_DURATION_MIN,
  eventDurationMin,
  googleCalendarUrl,
  icalUtc,
  interviewCalendarEvent,
  outlookCalendarUrl,
} from "./calendar-links.ts";

const EV = {
  title: "Interview · Jane Doe — Backend Engineer",
  start: "2026-06-01T14:00:00.000Z",
  end: "2026-06-01T14:45:00.000Z",
  description: "Line one.\nLine two; with, punctuation.",
  location: "Online interview",
};

test("icalUtc renders the UTC basic form", () => {
  assert.equal(icalUtc("2026-06-01T14:00:00.000Z"), "20260601T140000Z");
  assert.equal(icalUtc("2026-12-31T09:05:30Z"), "20261231T090530Z");
});

test("googleCalendarUrl carries a valid TEMPLATE with a start/end range", () => {
  const u = new URL(googleCalendarUrl(EV));
  assert.equal(u.origin + u.pathname, "https://calendar.google.com/calendar/render");
  assert.equal(u.searchParams.get("action"), "TEMPLATE");
  assert.equal(u.searchParams.get("text"), EV.title);
  assert.equal(u.searchParams.get("dates"), "20260601T140000Z/20260601T144500Z");
  assert.equal(u.searchParams.get("location"), "Online interview");
});

test("outlookCalendarUrl targets the compose deeplink with ISO start/end", () => {
  const u = new URL(outlookCalendarUrl(EV));
  assert.equal(u.origin + u.pathname, "https://outlook.office.com/calendar/0/deeplink/compose");
  assert.equal(u.searchParams.get("rru"), "addevent");
  assert.equal(u.searchParams.get("subject"), EV.title);
  assert.equal(u.searchParams.get("startdt"), EV.start);
  assert.equal(u.searchParams.get("enddt"), EV.end);
});

test("eventDurationMin recovers whole minutes between start and end", () => {
  assert.equal(eventDurationMin(EV), 45);
  assert.equal(eventDurationMin({ ...EV, end: "2026-06-01T14:30:00.000Z" }), 30);
  // Never zero/negative — the .ics builder clamps, and a degenerate range floors to 1.
  assert.equal(eventDurationMin({ ...EV, end: EV.start }), 1);
});

test("interviewCalendarEvent derives end from duration + builds a reschedule link", () => {
  const ev = interviewCalendarEvent(
    { token: "tok9", candidateLabel: "Jane Doe", jobTitle: "Backend Engineer", slotAt: "2026-06-01T14:00:00.000Z", durationMin: 30 },
    { baseUrl: "https://kp.example/", stage: "Screened", matchScore: 82 }
  );
  assert.ok(ev);
  assert.equal(ev.start, "2026-06-01T14:00:00.000Z");
  assert.equal(ev.end, "2026-06-01T14:30:00.000Z");
  assert.equal(ev.title, "Interview · Jane Doe — Backend Engineer");
  assert.match(ev.description ?? "", /Stage: Screened\./);
  assert.match(ev.description ?? "", /Match score: 82\/100\./);
  assert.match(ev.description ?? "", /https:\/\/kp\.example\/schedule\/tok9/);
});

test("interviewCalendarEvent uses a meeting link as location + a Join line", () => {
  const ev = interviewCalendarEvent(
    { token: "t", candidateLabel: "A", jobTitle: "Dev", slotAt: "2026-06-01T14:00:00.000Z", durationMin: 30 },
    { meetingUrl: "https://meet.example/xyz " }
  );
  assert.equal(ev?.location, "https://meet.example/xyz");
  assert.match(ev?.description ?? "", /Join: https:\/\/meet\.example\/xyz/);
  // No link → a neutral placeholder location, no Join line.
  const ev2 = interviewCalendarEvent({ token: "t", candidateLabel: "A", jobTitle: "Dev", slotAt: "2026-06-01T14:00:00.000Z", durationMin: 30 });
  assert.equal(ev2?.location, "Online interview");
  assert.doesNotMatch(ev2?.description ?? "", /Join:/);
});

test("interviewCalendarEvent is null without a slot; defaults duration to 45 min", () => {
  assert.equal(interviewCalendarEvent({ token: "t", candidateLabel: "A", jobTitle: null, slotAt: null, durationMin: null }), null);
  const ev = interviewCalendarEvent({ token: "t", candidateLabel: "A", jobTitle: null, slotAt: "2026-06-01T14:00:00.000Z", durationMin: null });
  assert.equal(ev?.end, "2026-06-01T14:45:00.000Z");
});

// bug-ui-scan-2026-07-09 (interview-scheduling-prep-rubric #5) — the candidate and
// recruiter events must agree on the DEFAULTS (duration + location) for one
// interview. Non-vacuity: pre-fix SchedulePicker inlined `durationMin ?? 30` and
// `location: undefined`, so a no-duration invite blocked 30 min (not 45) and named
// no location — both assertions below fail against that code.
const CANDIDATE_STRINGS = { title: "Interview", description: "Your interview.", joinLabel: "Join", locationOnline: "Online interview" };

test("candidateCalendarEvent shares the recruiter's default duration + location", () => {
  const slotAt = "2026-06-01T14:00:00.000Z";
  const cand = candidateCalendarEvent({ slotAt, durationMin: null, meetingUrl: null }, CANDIDATE_STRINGS);
  const rec = interviewCalendarEvent({ token: "t", candidateLabel: "A", jobTitle: null, slotAt, durationMin: null });
  assert.ok(cand && rec);
  // Same end instant → same blocked length as the recruiter's calendar.
  assert.equal(cand.end, rec.end, "candidate and recruiter block the same duration");
  assert.equal(cand.end, "2026-06-01T14:45:00.000Z");
  assert.equal(DEFAULT_DURATION_MIN, 45);
  // A neutral (localized) location instead of an empty one.
  assert.equal(cand.location, "Online interview");
});

test("candidateCalendarEvent honors a real meeting link + explicit duration", () => {
  const ev = candidateCalendarEvent(
    { slotAt: "2026-06-01T14:00:00.000Z", durationMin: 22, meetingUrl: " https://meet.example/xyz " },
    CANDIDATE_STRINGS
  );
  assert.equal(ev?.end, "2026-06-01T14:22:00.000Z", "explicit duration wins over the default");
  assert.equal(ev?.location, "https://meet.example/xyz", "trimmed join link becomes the location");
  assert.match(ev?.description ?? "", /Join: https:\/\/meet\.example\/xyz/);
});

test("candidateCalendarEvent is null without a booked slot", () => {
  assert.equal(candidateCalendarEvent({ slotAt: null, durationMin: 30, meetingUrl: null }, CANDIDATE_STRINGS), null);
});
