// A live strip click used to call setOrgLanguage immediately, so skipping after
// a language tap still left the workspace default (candidate mail, automation)
// on that locale. choose() must move the UI cookie only; finish() is the one
// writer of the org language.
//
// SOURCE-LEVEL: SetupLanguageSwitch is a client component and the unit runner
// has no React renderer. The contract is which server action choose() calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finishPartsFor } from "./setupOnboardingFinish.ts";
import { INITIAL_SETUP } from "./setupSteps.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const switchSrc = readFileSync(path.join(HERE, "SetupLanguageSwitch.tsx"), "utf8");
const finishSrc = readFileSync(path.join(HERE, "setupOnboardingFinish.ts"), "utf8");

function chooseBody(): string {
  const start = switchSrc.indexOf("function choose(");
  const end = switchSrc.indexOf("const strip =", start);
  assert.ok(start >= 0 && end > start, "choose() must still sit above the strip");
  return switchSrc.slice(start, end);
}

test("a live strip click does not write org language", () => {
  const body = chooseBody();
  assert.doesNotMatch(body, /setOrgLanguage/, "choose() must not persist the workspace default");
  assert.match(body, /setLocale\(language\)/, "the UI cookie is what lets the remaining steps be read");
  assert.doesNotMatch(switchSrc, /from "@\/app\/_lib\/org-actions"/);
  assert.match(switchSrc, /from "@\/i18n\/actions"/);
});

test("finish remains the one wizard writer of org language", () => {
  assert.match(finishSrc, /setOrgLanguage\(state\.language\)/);
  assert.equal(finishPartsFor(INITIAL_SETUP)[0], "language");
  assert.ok(finishPartsFor({ ...INITIAL_SETUP, intent: "seek" }).includes("language"));
});
