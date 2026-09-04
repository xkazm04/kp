import { parseLocaleNumber } from "./parseLocaleNumber";

// The decision half of InlineNumberSave, extracted so it can be EXECUTED by a test
// rather than only read by a source-level one. Everything this module decides was
// previously inlined in a `.tsx` (which Node's type-stripping runner cannot import),
// so the three rules below — each of which shipped as a fix for a real defect — had
// no behavioural coverage at all:
//
//  1. Parse in the READER's notation. `Number("12.000")` is 12, so a `de` operator
//     correcting a channel's spend to 12.000 stored twelve crowns while `en`'s
//     `12,000` failed visibly. Only the locale removes that guess.
//  2. A typed `0` is "no value", never a stored zero. Both stores behind this input
//     DELETE the row when `!(v > 0)` and still answer 200, so the field must show
//     the same "—" the column it feeds shows. It did not: the server value came back
//     unchanged (null), the prop-resync never fired, and `0` sat in the input for the
//     rest of the session beside a column reading "—".
//  3. An unchanged value sends no request — but still re-seeds the draft, so "007"
//     and " 5000 " collapse onto the value that would actually be stored.
//
// `canonical` is what the input should DISPLAY after the decision; `value` is what
// the caller should persist. Pure: no React, no fetch, no clock.

/** What the caller should do with the current draft. */
export type InlineSavePlan =
  /** Unparseable, negative, or non-finite — refuse visibly and write nothing. */
  | { kind: "invalid" }
  /** Already the stored value: re-seed the display, send no request. */
  | { kind: "unchanged"; canonical: string }
  /** Persist `value` (null clears the row) and re-seed the display. */
  | { kind: "save"; value: number | null; canonical: string };

export function planInlineSave(draft: string, current: number | null, locale: string): InlineSavePlan {
  const parsed = parseLocaleNumber(draft, locale);
  // `null` is a legitimately EMPTIED field (clear the row); a parsed-but-unusable
  // number is a refusal. The two are only distinguishable in that order.
  if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) return { kind: "invalid" };
  const value = parsed != null && parsed > 0 ? parsed : null;
  const canonical = value != null ? String(value) : "";
  if (value === current) return { kind: "unchanged", canonical };
  return { kind: "save", value, canonical };
}
