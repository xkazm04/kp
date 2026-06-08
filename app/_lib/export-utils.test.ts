import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv, buildIcs } from "./export-utils.ts";

// The export toolkit's pure serializers (Theme C). The browser helpers
// (downloadFile/copyText) touch DOM globals and aren't exercised here; these two
// carry the load-bearing escaping/format logic, so they're pinned directly.

test("toCsv leaves simple cells unquoted", () => {
  assert.equal(toCsv([["a", "b", 1]]), "a,b,1");
});

test("toCsv quotes + escapes cells with comma, quote, or newline", () => {
  assert.equal(toCsv([["a,b", 'he said "hi"', "line1\nline2"]]), '"a,b","he said ""hi""","line1\nline2"');
});

test("toCsv renders null/undefined as empty and joins rows with CRLF", () => {
  assert.equal(toCsv([["h1", "h2"], [null, undefined]]), "h1,h2\r\n,");
});

test("buildIcs emits a single VEVENT with UTC DTSTART/DTEND and computed end", () => {
  const ics = buildIcs({
    uid: "iv-1",
    start: "2030-01-02T09:00:00.000Z",
    durationMin: 30,
    title: "Interview",
    stamp: "2030-01-01T00:00:00.000Z",
  });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nEND:VCALENDAR$/);
  assert.ok(ics.includes("UID:iv-1"));
  assert.ok(ics.includes("DTSTAMP:20300101T000000Z"));
  assert.ok(ics.includes("DTSTART:20300102T090000Z"));
  assert.ok(ics.includes("DTEND:20300102T093000Z")); // +30 min
  assert.ok(ics.includes("SUMMARY:Interview"));
});

test("buildIcs escapes ICS-special chars in text fields", () => {
  const ics = buildIcs({
    uid: "iv-2",
    start: "2030-01-02T09:00:00.000Z",
    durationMin: 45,
    title: "Screen; round 1, with AI",
    description: "Line one\nLine two",
    location: "Remote, browser",
  });
  assert.ok(ics.includes("SUMMARY:Screen\\; round 1\\, with AI"));
  assert.ok(ics.includes("DESCRIPTION:Line one\\nLine two"));
  assert.ok(ics.includes("LOCATION:Remote\\, browser"));
});

test("buildIcs omits optional DESCRIPTION/LOCATION when absent and throws on a bad date", () => {
  const ics = buildIcs({ uid: "iv-3", start: "2030-01-02T09:00:00.000Z", durationMin: 15, title: "X" });
  assert.ok(!ics.includes("DESCRIPTION:"));
  assert.ok(!ics.includes("LOCATION:"));
  assert.throws(() => buildIcs({ uid: "x", start: "not-a-date", durationMin: 10, title: "X" }));
});
