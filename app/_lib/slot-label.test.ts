// The slot label's formatters are built ONCE per locale.
//
// `useSlotLabel` returns a `useCallback`, which made it look memoized — but the
// callback constructed TWO `Intl.DateTimeFormat`s on every invocation, i.e. two
// per rendered slot. A schedule offering twelve slots built twenty-four
// formatters on every render of the list, and the stable callback identity hid
// it completely: the thing that was memoized was not the thing that was
// expensive.
//
// Keying the cache by locale is also what keeps the locale a PARAMETER rather
// than the ambient default — the same argument `useTableSort`'s collator map
// makes (the runtime default is the server's locale during SSR and the
// browser's after hydration, and the two disagree).
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSlotLabel, slotFormatters } from "./use-slot-label.ts";

test("the formatter pair is cached per locale", () => {
  assert.strictEqual(slotFormatters("cs"), slotFormatters("cs"), "same locale must reuse the same pair");
  assert.notStrictEqual(slotFormatters("cs"), slotFormatters("de"), "a different locale is a different pair");
});

test("a slot renders as <date> · <time>, in the locale asked for", () => {
  // Noon UTC on a fixed date, so the shape is asserted without pinning a
  // timezone-dependent hour.
  const out = formatSlotLabel("2026-06-10T12:00:00.000Z", "en");
  assert.match(out, / · /, "mirrors the server label's shape");
  assert.match(out, /\d{2}:\d{2}$/, "24-hour time, no am/pm");
  // Different locales genuinely differ — the whole reason this is not the
  // server-minted English label.
  assert.notEqual(formatSlotLabel("2026-06-10T12:00:00.000Z", "cs"), out);
});

test("an absent or unparsable instant degrades to the fallback, never to blank", () => {
  // The fallback is the STORED English label; a booked slot rendering empty is
  // the failure this guard exists for.
  assert.equal(formatSlotLabel(null, "en", "Tue 10 Jun · 10:00"), "Tue 10 Jun · 10:00");
  assert.equal(formatSlotLabel(undefined, "en", "Tue 10 Jun · 10:00"), "Tue 10 Jun · 10:00");
  assert.equal(formatSlotLabel("not-a-date", "en", "Tue 10 Jun · 10:00"), "Tue 10 Jun · 10:00");
  // With no fallback to offer, empty is the honest answer — not "Invalid Date".
  assert.equal(formatSlotLabel("not-a-date", "en"), "");
});
