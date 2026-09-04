// Source guard: the two facts a degraded intake turn produces must REACH the
// reader, and a turn that overran its budget must be named.
//
// The engine has always answered `fallbackReason` (WHY it fell back) and
// `fallbackLang` (which of the four scripted locales it served when the session
// asked for one the script does not carry). `/message` put the first on the
// wire and dropped the second; `/voice-turn` did the same; and no pane rendered
// either, so a keyless install and a provider outage produced the identical
// sentence "AI is offline, so the guided checklist runs instead" and an
// operator retried forever. The stand-in language was never disclosed at all.
//
// Source-guard style (mirrors intake-refusal-guard.test.ts): node:test cannot
// resolve the "@/" alias, so the routes are asserted over their source text.
// Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

const TURN_ROUTES = {
  message: "./[id]/message/route.ts",
  "voice-turn": "./[id]/voice-turn/route.ts",
} as const;

for (const [name, rel] of Object.entries(TURN_ROUTES)) {
  const src = read(rel);

  test(`${name} forwards BOTH degradation facts`, () => {
    assert.match(src, /fallbackReason \? \{ fallbackReason:/, `${name} must forward the reason`);
    assert.match(src, /fallbackLang \? \{ fallbackLang:/, `${name} must forward the stand-in language`);
  });

  test(`${name} answers its own timeout with a code, not a store error`, () => {
    assert.match(
      src,
      /if \(error instanceof IntakeTimeoutError\) return jsonRefusal\("INTAKE_TURN_TIMEOUT", 504\)/,
      `${name} must name the overrun instead of filing it as a 500`
    );
    // Ordering matters: the abort check stays first (a cancelled request is not
    // a timeout), and the generic safeJsonError stays last.
    // lastIndexOf, not indexOf: both names also appear in the import block.
    assert.ok(
      src.lastIndexOf("request.signal.aborted") < src.lastIndexOf("IntakeTimeoutError"),
      "an abort is classified before a timeout"
    );
    assert.ok(
      src.lastIndexOf("IntakeTimeoutError") < src.lastIndexOf("safeJsonError"),
      "the timeout is classified before the generic store-error fallback"
    );
  });
}

test("the runner declares a budget for every intake thread", () => {
  const runner = read("../../_lib/intake-run.ts");
  for (const budget of [
    "INTAKE_OPENING_TIMEOUT_MS",
    "INTAKE_DIALOG_TIMEOUT_MS",
    "INTAKE_VOICE_TURN_TIMEOUT_MS",
    "INTAKE_EXTRACT_TIMEOUT_MS",
    "INTAKE_APP_MASTER_TIMEOUT_MS",
  ]) {
    assert.match(runner, new RegExp(`timeoutMs: ${budget}`), `${budget} must be passed to a spawn`);
  }
  assert.doesNotMatch(
    runner,
    /const \{ result \} = spawnPython\(args, \{ signal(,| \})/,
    "every spawn goes through runIntakeSpawn, so none can inherit the 10-minute default"
  );
});

test("INTAKE_TURN_TIMEOUT is a declared refusal", () => {
  const responses = read("../../_lib/api-response.ts");
  assert.match(responses, /INTAKE_TURN_TIMEOUT:/, "the code must exist in REFUSAL_ERRORS");
});
