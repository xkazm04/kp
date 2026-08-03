// SET-EQUALITY GUARD for the calendar-honesty catalog.
//
// The recruiter reschedule picker renders one of CALENDAR_STATUSES by key
// (`t(`calendarStatus.${status}`)`), so a state added to the code without a
// translation renders raw English into a Czech/German/French UI — a failure a
// previous round shipped past three green gates (a 4-key catalog against a
// 13-kind vocabulary, 23 of 40 rows English in a German UI). Key PARITY across
// locales is scripts/i18n-check.mjs's job; what it cannot see is whether the
// catalog matches the CODE's canonical list. That is this test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CALENDAR_STATUSES } from "./free-busy.ts";

const LOCALES = ["en", "cs", "de", "fr"] as const;
const MESSAGES = path.join(process.cwd(), "messages");

const catalog = (locale: string): Record<string, unknown> => {
  const m = JSON.parse(readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8")) as {
    scheduleTab: { lifecycle: { calendarStatus?: Record<string, unknown> } };
  };
  return m.scheduleTab.lifecycle.calendarStatus ?? {};
};

test("every calendar status has a translation in EVERY locale, and no orphans", () => {
  const expected = [...CALENDAR_STATUSES].sort();
  for (const locale of LOCALES) {
    const keys = Object.keys(catalog(locale)).sort();
    assert.deepEqual(
      keys,
      expected,
      `messages/${locale}.json scheduleTab.lifecycle.calendarStatus must set-equal CALENDAR_STATUSES`
    );
    for (const key of keys) {
      const value = catalog(locale)[key];
      assert.equal(typeof value, "string", `${locale}.${key} must be a string`);
      assert.ok((value as string).trim().length > 0, `${locale}.${key} must not be empty`);
    }
  }
});

test("the candidate-facing calendar note exists in every locale (both states)", () => {
  // The candidate gets ONE bit — checked / not checked — never the reason and never a
  // busy count. Both halves must exist everywhere or the picker renders a raw key.
  for (const locale of LOCALES) {
    const m = JSON.parse(readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8")) as {
      schedule: Record<string, unknown>;
    };
    for (const key of ["calendarCheckedNote", "calendarUncheckedNote"]) {
      assert.equal(typeof m.schedule[key], "string", `messages/${locale}.json schedule.${key} is missing`);
    }
  }
});

test("'checked' is the ONLY status that may claim a calendar was consulted", () => {
  // A guard on the vocabulary itself: the two non-checked states exist precisely so an
  // outage and a genuinely clear calendar stop being the same sentence.
  assert.deepEqual([...CALENDAR_STATUSES], ["checked", "not_connected", "unavailable"]);
});
