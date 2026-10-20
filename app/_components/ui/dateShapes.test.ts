import { test } from "node:test";
import assert from "node:assert/strict";
import { createDateFormatters, DATE_SHAPES } from "./dateShapes.ts";

test("all four shared date shapes match Intl and honor an explicit time zone", () => {
  const formats = createDateFormatters("de");
  const at = "2026-09-03T14:30:00.000Z";
  for (const name of ["date", "dateTime", "dayTime", "time"] as const) {
    const expected = new Intl.DateTimeFormat("de", { ...DATE_SHAPES[name], timeZone: "UTC" }).format(new Date(at));
    assert.equal(formats[name](at, { timeZone: "UTC" }), expected);
  }
});

test("plain callers get the same safe fallback for absent or invalid dates", () => {
  const formats = createDateFormatters("en");
  assert.equal(formats.date(null), "—");
  assert.equal(formats.date("not a date", { fallback: "Unknown" }), "Unknown");
});
