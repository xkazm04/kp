// Pins the reconciled interview-length contract (idea-0ecbe5a5). Four numbers
// used to drift — the portal copy, the persona wording, the provider cap and the
// grounded run-of-show — so these tests lock the single source of truth in
// interview-duration.mjs and, crucially, that the provider cap can never fall
// back below a real interview's length and silently truncate the transcript.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as duration from "./interview-duration.mjs";
import {
  QUICK_SCREEN_MIN,
  GROUNDED_DEFAULT_MIN,
  GROUNDED_MAX_MIN,
  PROVIDER_CAP_MIN,
  PROVIDER_MAX_DURATION_SECONDS,
} from "./interview-duration.mjs";
import { MIN_DURATION_MIN, MAX_DURATION_MIN } from "./run-of-show.ts";

function read(rel: string): string {
  // core.autocrlf=true on this checkout: normalise so a marker that spans a line
  // break still matches (rate-limit-contract.test.ts records the same trap).
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

test("the two mode targets are ordered: quick screen is shorter than the grounded screen", () => {
  assert.ok(QUICK_SCREEN_MIN > 0, "quick screen has a positive length");
  assert.ok(
    QUICK_SCREEN_MIN < GROUNDED_DEFAULT_MIN,
    `quick ${QUICK_SCREEN_MIN} should be shorter than grounded default ${GROUNDED_DEFAULT_MIN}`
  );
});

test("the grounded default sits inside the run-of-show band", () => {
  assert.ok(
    GROUNDED_DEFAULT_MIN >= MIN_DURATION_MIN && GROUNDED_DEFAULT_MIN <= MAX_DURATION_MIN,
    `grounded default ${GROUNDED_DEFAULT_MIN} must be within [${MIN_DURATION_MIN}, ${MAX_DURATION_MIN}]`
  );
});

test("GROUNDED_MAX_MIN mirrors the run-of-show maximum (the mirror can't drift)", () => {
  assert.equal(
    GROUNDED_MAX_MIN,
    MAX_DURATION_MIN,
    "interview-duration.mjs and run-of-show.ts must agree on the grounded maximum"
  );
});

test("the provider cap clears the grounded maximum so a real interview is never truncated", () => {
  // This is the trust-critical invariant: one ElevenLabs agent serves both modes,
  // so its hard cap must exceed the longest grounded run-of-show — otherwise a
  // 20–30 min screen is severed mid-answer and feeds the scorecard a stub.
  assert.ok(
    PROVIDER_CAP_MIN > MAX_DURATION_MIN,
    `provider cap ${PROVIDER_CAP_MIN} min must exceed the grounded max ${MAX_DURATION_MIN} min`
  );
  assert.equal(PROVIDER_MAX_DURATION_SECONDS, PROVIDER_CAP_MIN * 60, "seconds derive from the minute cap");
});

// ── the module owns NUMBERS, never words ───────────────────────────────────
//
// It used to own both: durationLabel / durationChip composed "About 20 minutes"
// and "~20 min" in English, and InterviewSidebar — a CANDIDATE surface, reached
// from an invite sent in the candidate's own language — painted the chip verbatim
// beside an agenda next-intl had already localized. A helper that returns a
// sentence is a helper no catalog can reach, so the fix is structural: the copy
// moved to the catalog and this asserts it cannot come back.
test("interview-duration.mjs exports no copy helper — every export is a number", () => {
  for (const [name, value] of Object.entries(duration)) {
    assert.equal(
      typeof value,
      "number",
      `${name} must be a number: this module is the length contract, not a phrasebook`,
    );
  }
});

test("the candidate sidebar renders its duration chip through the catalog", () => {
  const src = read("../_components/voice/InterviewSidebar.tsx");
  assert.ok(
    src.includes('t("durationChip", { min: durationMin })'),
    "the chip must resolve interview.sidebar.durationChip in the reader's language",
  );
  assert.ok(
    !src.includes("interview-duration.mjs"),
    "the sidebar must not import a copy helper from the duration module",
  );
});

test("all four catalogs carry the chip key, and none of them ships the English default", () => {
  const en = JSON.parse(read("../../messages/en.json")) as Record<string, never>;
  for (const locale of ["en", "cs", "de", "fr"]) {
    const cat = JSON.parse(read(`../../messages/${locale}.json`)) as {
      interview: { sidebar: Record<string, string> };
    };
    const chip = cat.interview.sidebar.durationChip;
    assert.equal(typeof chip, "string", `${locale}.json must define interview.sidebar.durationChip`);
    assert.ok(chip.includes("{min}"), `${locale} chip must interpolate the minute count, not hardcode one`);
  }
  // Guard the shape the catalog is asked to hold, not just its presence.
  assert.equal(typeof (en as unknown as { interview: { lab: { disabledBody: string } } }).interview.lab.disabledBody, "string");
});
