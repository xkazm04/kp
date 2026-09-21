// Pins that a committed screen-wave with sealFailures reaches the tab banner.
// runScreenWave already counts missed Art. 22 seals; WaveResult used to omit
// the field, so the recruiter only saw commsFailures after the modal closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { committedWaveNeedsSealBanner } from "./decisionsScreenWaveTypes.ts";

function source(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

test("a fixture commit with sealFailures:1 paints the banner", () => {
  assert.equal(committedWaveNeedsSealBanner({ sealFailures: 1 }), true);
  assert.equal(committedWaveNeedsSealBanner({ sealFailures: 0 }), false);
});

test("WaveResult requires sealFailures so a result without the field is a type error", () => {
  const types = source("./decisionsScreenWaveTypes.ts");
  assert.match(types, /export type WaveResult = \{[\s\S]*sealFailures:\s*number/, "WaveResult must require sealFailures");
  assert.match(types, /export type WaveCommitSummary = \{[\s\S]*sealFailures:\s*number/, "the post-commit summary must carry sealFailures");
});

test("onCommitted forwards sealFailures and the coral tab banner renders them", () => {
  const hook = source("./useDecisionsScreenWave.ts");
  assert.match(hook, /sealFailures:\s*result\.sealFailures/, "the commit summary must forward sealFailures");

  const modals = source("./DecisionsModals.tsx");
  assert.match(modals, /summary\.sealFailures\s*>\s*0/, "a committed wave with sealFailures must reach tab state");

  const banners = source("./DecisionsBanners.tsx");
  assert.match(banners, /committedWaveNeedsSealBanner/, "the coral banner is gated on the helper");
  assert.match(banners, /text-coral/, "the banner is coral, not the amber comms warning");
  assert.match(banners, /wave\.reasons\.sealFailed/, "copy must not claim the wave was fully recorded");
});
