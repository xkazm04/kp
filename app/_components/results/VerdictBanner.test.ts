/*
 * What the verdict banner ANNOUNCES.
 *
 * `role="img"` makes every child of the banner presentational, so the composed
 * `aria-label` is the whole banner to a screen reader — and it is the one part
 * of this component a visual review cannot see. Wave 21a widened that label from
 * "score + band" to the full readout precisely because a multi-variant run's
 * winner was announced nowhere; nothing then pinned it, so the next edit to the
 * chips could silently narrow it back.
 *
 * The composition is `verdictAria.ts` (pure); the wiring is read off the .tsx,
 * since a helper the component stopped calling passes every unit test it has.
 *
 *   npm run test:unit
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FRAMING_KEY, verdictAriaLabel, type VerdictAriaKey } from "./verdictAria.ts";

const src = readFileSync(fileURLToPath(new URL("./VerdictBanner.tsx", import.meta.url)), "utf8");

/** A translator that echoes the key and its values, so order and inclusion show. */
const t = (key: VerdictAriaKey, values?: Record<string, string | number>): string =>
  values ? `${key}(${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(",")})` : key;

test("self-check: VerdictBanner.tsx was read", () => {
  assert.ok(src.includes("export function VerdictBanner"), "VerdictBanner.tsx did not parse as expected");
});

test("a scored run announces score, band and framing in the painted reading order", () => {
  assert.equal(
    verdictAriaLabel(t, { overall: 82, band: "Strong", jobFit: null, winnerLabel: null, tone: "strong" }),
    "verdict.aria(score=82,band=Strong). verdict.framingStrong"
  );
});

test("an unscored run says so, and never fabricates a band", () => {
  const label = verdictAriaLabel(t, { overall: null, band: null, jobFit: null, winnerLabel: null, tone: "null" });
  assert.equal(label, "verdict.ariaUnscored. verdict.framingNone");
  assert.doesNotMatch(label, /verdict\.aria\(/);
});

test("each of the four framings is the last thing spoken", () => {
  const tones = [
    { tone: "strong", key: "verdict.framingStrong" },
    { tone: "mid", key: "verdict.framingMid" },
    { tone: "weak", key: "verdict.framingWeak" },
    { tone: "null", key: "verdict.framingNone" },
  ] as const;
  for (const { tone, key } of tones) {
    const label = verdictAriaLabel(t, { overall: 50, band: "Mixed", jobFit: 40, winnerLabel: "CV B", tone });
    assert.ok(label.endsWith(key), `${tone}: expected the label to end with ${key}, got "${label}"`);
    assert.equal(FRAMING_KEY[tone], key);
  }
});

test("the winner — the one fact a multi-variant banner exists to deliver — is announced", () => {
  const label = verdictAriaLabel(t, { overall: 74, band: "Strong", jobFit: 68, winnerLabel: "CV — final.pdf", tone: "strong" });
  assert.equal(
    label,
    "verdict.aria(score=74,band=Strong). verdict.jobFit(score=68). verdict.winner(label=CV — final.pdf). verdict.framingStrong"
  );
});

test("absent parts are dropped, not spoken as empty fragments", () => {
  const label = verdictAriaLabel(t, { overall: 30, band: "Weak", jobFit: null, winnerLabel: "", tone: "weak" });
  assert.equal(label, "verdict.aria(score=30,band=Weak). verdict.framingWeak");
  assert.doesNotMatch(label, /\.\s*\./, "an empty part left a doubled separator");
});

test("a zero job fit is a figure, not a missing part", () => {
  // `jobFit != null`, never truthiness: 0/100 is the most important fit to hear.
  const label = verdictAriaLabel(t, { overall: 12, band: "Weak", jobFit: 0, winnerLabel: null, tone: "weak" });
  assert.match(label, /verdict\.jobFit\(score=0\)/);
});

test("the banner composes its label through the helper", () => {
  assert.match(src, /const ariaLabel = verdictAriaLabel\(t, \{/);
  assert.match(src, /aria-label=\{ariaLabel\}/);
  assert.match(src, /role="img"/);
});

test("the banner composes PANEL rather than re-typing it", () => {
  assert.match(src, /\$\{PANEL\} border-l-4/);
  assert.doesNotMatch(src, /rounded-lg border border-stone-200/);
});

test("the readout stays on the workspace type scale", () => {
  assert.doesNotMatch(src, /text-2xl/, "text-2xl is off the workspace scale (globals.css)");
  assert.match(src, /text-display font-bold leading-none nums/);
});
