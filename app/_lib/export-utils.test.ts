import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv, buildIcs, downloadFile } from "./export-utils.ts";

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

// bug-ui-scan 2026-07-09 (analytics-calibration-dashboards #1): toCsv escaped RFC-4180
// delimiters but not spreadsheet FORMULA triggers, so a candidate-controlled name flowing
// into the decision-log / roles export executed on open. RFC-4180 quoting does not help --
// the parser strips the quotes before the cell is evaluated.
test("toCsv neutralizes leading formula triggers in candidate-controlled text", () => {
  const rows = [["=cmd|'/c calc'!A1"], ["+1+1"], ["-1+1"], ["@SUM(1)"], ["\tSUM(1)"]];
  const lines = toCsv(rows).split("\r\n");
  for (const l of lines) {
    // Each cell must begin with the text marker (possibly inside RFC-4180 quotes), never
    // with a bare trigger character.
    const body = l.startsWith('"') ? l.slice(1) : l;
    assert.equal(body[0], "'", `cell must be neutralized, got: ${l}`);
  }
});

test("toCsv leaves ordinary text and numbers untouched", () => {
  assert.equal(toCsv([["Jane Doe", 42]]), "Jane Doe,42");
  // A negative number is data, not a formula: it must still import as a number.
  assert.equal(toCsv([[-1]]), "-1");
  assert.equal(toCsv([[0]]), "0");
});

// bug-hunt lib-shared-utils-1: icsText escaped `\r\n` and `\n` but not a LONE `\r`,
// so a candidate-controlled SUMMARY/DESCRIPTION could carry a raw carriage return
// into the middle of a content line. RFC 5545 delimits with CRLF, but real-world
// parsers split on any of CR / LF / CRLF and then read the tail as a NEW property —
// the interviewer's calendar hold takes an attacker-chosen time.
test("buildIcs escapes a lone CR so a value cannot inject a second property", () => {
  const ics = buildIcs({
    uid: "iv-4",
    start: "2030-01-02T09:00:00.000Z",
    durationMin: 30,
    title: "Ada\rDTSTART:19700101T000000Z",
    description: "one\rtwo\r\nthree\nfour",
  });
  assert.ok(ics.includes("SUMMARY:Ada\\nDTSTART:19700101T000000Z"), `un-escaped CR in SUMMARY: ${JSON.stringify(ics)}`);
  assert.ok(ics.includes("DESCRIPTION:one\\ntwo\\nthree\\nfour"));
  // The general invariant: the only CR in the document is the one that pairs with
  // the LF of a line separator.
  assert.equal(/\r(?!\n)/.test(ics), false, "a raw CR survived into a content line");
});

// bug-hunt lib-shared-utils-1: a CSV downloaded WITHOUT a UTF-8 BOM is decoded by
// Excel-on-Windows with the machine's ANSI codepage, so every Czech/German name in a
// candidate export opened as mojibake. Browser-only helper, so the browser surface it
// actually touches (document / Blob / URL object URLs) is stubbed; stubbing Blob also
// captures the exact bytes the saved file would carry.
function captureDownload(run: () => void): { body: string; type: string; filename: string } {
  const realBlob = globalThis.Blob;
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  const captured = { body: "", type: "", filename: "" };
  const anchor = { href: "", download: "", click() {}, remove() {} };
  const g = globalThis as unknown as Record<string, unknown>;
  g.Blob = class {
    constructor(parts: string[], options: { type: string }) {
      captured.body = parts.join("");
      captured.type = options.type;
    }
  };
  URL.createObjectURL = (() => "blob:stub") as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => {}) as unknown as typeof URL.revokeObjectURL;
  g.document = { createElement: () => anchor, body: { appendChild() {} } };
  try {
    run();
  } finally {
    g.Blob = realBlob;
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
    delete g.document;
  }
  captured.filename = anchor.download;
  return captured;
}

test("downloadFile prefixes a UTF-8 BOM on CSV so a spreadsheet reads diacritics", () => {
  const csv = toCsv([["Candidate"], ["Šárka Nováková"]]);
  const out = captureDownload(() => downloadFile("matches.csv", csv, "text/csv"));
  assert.equal(out.body.charCodeAt(0), 0xfeff, "the CSV must open with a UTF-8 BOM");
  assert.equal(out.body.slice(1), csv, "the BOM is the only change — the rows are untouched");
  assert.equal(out.filename, "matches.csv");
});

test("downloadFile leaves non-CSV downloads byte-exact and never double-BOMs", () => {
  const ics = buildIcs({ uid: "iv-5", start: "2030-01-02T09:00:00.000Z", durationMin: 15, title: "X" });
  assert.equal(captureDownload(() => downloadFile("hold.ics", ics, "text/calendar")).body, ics);
  assert.equal(captureDownload(() => downloadFile("a.md", "# Report", "text/markdown")).body, "# Report");
  assert.equal(captureDownload(() => downloadFile("a.json", "{}", "application/json")).body, "{}");
  // Idempotent: content that already carries the marker is not given a second one.
  const withBom = `${String.fromCharCode(0xfeff)}a,b`;
  assert.equal(captureDownload(() => downloadFile("x.csv", withBom, "text/csv")).body, withBom);
});

test("toCsv still quotes and round-trips delimiters after neutralizing", () => {
  // A quote + comma inside a formula-triggering cell: both rules must compose.
  assert.equal(toCsv([['=a"b,c']]), `"'=a""b,c"`);
  // And plain RFC-4180 behaviour is unchanged.
  assert.equal(toCsv([['say "hi", ok']]), `"say ""hi"", ok"`);
  assert.equal(toCsv([["line\nbreak"]]), `"line\nbreak"`);
});
