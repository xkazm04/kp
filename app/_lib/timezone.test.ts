import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidTimeZone, timeZoneShortLabel } from "./timezone.ts";

// A fixed winter instant so any DST ambiguity is removed from the assertions.
const ISO = "2026-01-15T10:00:00.000Z";

test("isValidTimeZone accepts real IANA zones and rejects junk", () => {
  assert.equal(isValidTimeZone("Europe/Prague"), true);
  assert.equal(isValidTimeZone("America/New_York"), true);
  assert.equal(isValidTimeZone("UTC"), true);
  assert.equal(isValidTimeZone("Not/AZone"), false);
  assert.equal(isValidTimeZone(""), false);
  assert.equal(isValidTimeZone(null), false);
  assert.equal(isValidTimeZone(123), false);
  // Overlong strings (a spoofed body value) are rejected before reaching Intl.
  assert.equal(isValidTimeZone("A".repeat(80)), false);
});

test("timeZoneShortLabel returns a non-empty zone label for a valid instant+zone", () => {
  assert.notEqual(timeZoneShortLabel(ISO, "en-US", "Europe/Prague"), "");
  assert.notEqual(timeZoneShortLabel(ISO, "en-US", "America/New_York"), "");
  // Distinct zones must not render the same label (the whole point of showing it).
  assert.notEqual(
    timeZoneShortLabel(ISO, "en-US", "Europe/Prague"),
    timeZoneShortLabel(ISO, "en-US", "America/New_York")
  );
});

test("timeZoneShortLabel degrades to '' on bad input rather than throwing", () => {
  assert.equal(timeZoneShortLabel(null, "en-US"), "");
  assert.equal(timeZoneShortLabel(undefined, "en-US"), "");
  assert.equal(timeZoneShortLabel("not-a-date", "en-US"), "");
  // An invalid explicit zone falls back to the runtime zone (still non-throwing).
  assert.equal(typeof timeZoneShortLabel(ISO, "en-US", "Bogus/Zone"), "string");
});
