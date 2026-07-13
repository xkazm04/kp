// Pins the winnability coach's salary band to the shared APP_CURRENCY formatter
// (sourcing-campaigns-rediscovery #5). The bug: CoachPanel's local `fmtBand` used
// `${a.toLocaleString("cs-CZ")} – ${b.toLocaleString("cs-CZ")} CZK` — a hardcoded
// "CZK" literal + spaces around the dash + a pinned Czech locale, bypassing the
// app's single salary-formatting contract.
//
// Non-vacuity: the pre-fix template ALWAYS rendered " – " (space-dash-space) around
// the two figures, whereas the shared formatter emits the canonical
// "45 000–60 000 CZK" (en-dash, no surrounding spaces). Asserting the output equals
// formatSalaryRange AND contains no " – " fails against the pre-fix template and
// passes once fmtBand delegates.
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtBand } from "./coach-salary.ts";
import { formatSalaryRange } from "@/app/_lib/format.ts";

test("fmtBand renders the band via the shared APP_CURRENCY formatter, not a cs-CZ + 'CZK' template", () => {
  const out = fmtBand([45000, 60000]);
  assert.equal(out, formatSalaryRange(45000, 60000));
  assert.notEqual(out, null);
  // The pre-fix template always put a space on each side of the dash; the shared
  // formatter does not. This is the discriminator that fails against pre-fix code.
  assert.ok(!out!.includes(" – "), `expected no spaces around the dash, got ${JSON.stringify(out)}`);
});

test("fmtBand returns null for an absent band (unchanged)", () => {
  assert.equal(fmtBand(null), null);
});
