// The SMTP card's catalog (`channelsNight.setup.smtp`) against the call shapes SetupSmtp uses:
// every message renders in every locale with the values the UI passes, and none carries an em dash.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { LOCALES } from "@/i18n/locales";
import { SMTP_PRESET_IDS } from "./smtpSetup.ts";

const CALLS: [string, Record<string, unknown>?][] = [
  ["title"], ["intro"], ["preset"], ["host"], ["port"], ["security"], ["securityTls"], ["securityStarttls"],
  ["address"], ["addressHelp"], ["fromName"], ["password"], ["passwordPlaceholder"], ["passwordKeep"], ["version", { version: 4 }],
  ["save"], ["saved"], ["saveFailed"], ["test"], ["testHint", { address: "o@s.cz" }],
  ["testOk", { code: 250, address: "o@s.cz" }], ["testFailed", { code: 535, stage: "AUTH", text: "bad" }], ["testNoReply", { stage: "connect", text: "timeout" }],
  ["testSealed"], ["recent"], ["recentEmpty"], ["attemptTest"], ["suppressed", { count: 1 }], ["suppressed", { count: 3 }], ["suppressed", { count: 7 }],
  ["suppressedHelp"], ["unsuppress"],
  ...["active", "precedence", "relayOnly", "off", "unreadable"].map((k): [string] => [`status.${k}`]),
  ...["ok", "busy", "noSender", "unreadable", "unsaved"].map((k): [string] => [`gate.${k}`]),
  ...["sent", "failed", "refused"].map((k): [string] => [`outcome.${k}`]),
  ...["sent", "retry", "failed", "refused"].map((k): [string] => [`attempt.${k}`]),
  ...SMTP_PRESET_IDS.flatMap((k): [string][] => [[`presets.${k}`], [`presetHelp.${k}`]]),
];

for (const locale of LOCALES) {
  test(`channelsNight.setup.smtp (${locale}): every message renders`, () => {
    const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8"));
    const t = createTranslator({ locale, messages }) as unknown as (k: string, v?: Record<string, unknown>) => string;
    for (const [key, values] of CALLS) {
      const out = t(`channelsNight.setup.smtp.${key}`, values);
      assert.ok(out.trim() && !out.includes("channelsNight."), `${locale} smtp.${key} is missing`);
      assert.ok(!/[{}]/.test(out), `${locale} smtp.${key} left a placeholder: ${out}`);
      assert.ok(!out.includes("—"), `${locale} smtp.${key} carries an em dash`);
    }
  });
}
