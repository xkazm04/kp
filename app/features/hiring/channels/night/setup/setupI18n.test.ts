// Level 1's catalog (`channelsNight.setup`) against the CALL SHAPES its components use: every message
// renders with the values the UI passes, in every locale that carries the sub-object (en now; cs / de /
// fr join as the translators land them), and the key maps the setup reads resolve.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { LOCALES, type Locale } from "@/i18n/locales";
import { EDGE_STATUS_KEY } from "./setupDelivery.ts";
import { FEED_STATE_KEY } from "./setupModel.ts";

type Render = (key: string, values?: Record<string, unknown>) => string;
function translator(locale: Locale): { t: Render; has: boolean } {
  const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8"));
  const t = createTranslator({ locale, messages }) as unknown as { markup: (k: string, v?: Record<string, unknown>) => string };
  return { t: (k, v) => t.markup(k, v), has: Boolean(messages.channelsNight?.setup) };
}

const CALLS: [string, Record<string, unknown>?][] = [
  ["stepper.label"], ["stepper.dot", { channel: "Email intake", state: "Waiting" }],
  ["careers.help"], ["careers.testHint", { role: "Data Engineer" }], ["careers.copyAria", { role: "Data Engineer" }],
  ["receivers.count", { count: 1 }], ["receivers.count", { count: 3 }], ["receivers.listEmail"], ["receivers.listAds"], ["receivers.addClose"],
  ["receiver.waitingNote"], ["receiver.reachNote"], ["receiver.newNote"], ["receiver.steps"], ["receiver.stepsHide"], ["receiver.cvHide"], ["receiver.pullHide"],
  ["receiver.messages"], ["receiver.remove"], ["receiver.firstReceived"], ["receiver.acceptedHint"],
  ["endpoint.reveal"], ["endpoint.hide"], ["endpoint.revealAria", { role: "R" }], ["endpoint.hideAria", { role: "R" }], ["endpoint.copyAria", { role: "R" }], ["endpoint.masked"],
  ["secret.set"], ["secret.setHidden"], ["secret.storedAria", { label: "Signing secret" }], ["secret.storedHelp"], ["secret.replace"], ["secret.keep"],
  ["secret.show"], ["secret.showAria"], ["secret.hideAria"], ["secret.generate"], ["secret.generatedOnce"], ["secret.copyGenerated"],
  ["feeds.edit"], ["feeds.add"], ["feeds.close"], ["feeds.lastError"], ["feeds.noError"], ["feeds.goTo", { channel: "Ad forms" }], ["feeds.listLabel"],
  ["relay.notSending", { count: 1 }], ["relay.notSending", { count: 58 }], ["relay.version", { version: 7 }],
  ["relay.gate.ok"], ["relay.gate.noRelay"], ["relay.gate.unsaved"], ["relay.gate.unreadable"], ["relay.gate.busy"],
  ["relay.outcome.sent"], ["relay.outcome.failed"], ["relay.outcome.refused"], ["relay.answered"], ["relay.carried"],
  ["relay.delivered"], ["relay.deliveredSub", { sent: 27, recovered: 4 }], ["relay.queued"], ["relay.queuedSub"], ["relay.queuedNotSent"],
  ["relay.needs"], ["relay.needsSub", { failed: 4, bounced: 4 }], ["relay.needsAbsent"], ["relay.unmatched"], ["relay.unmatchedAbsent"], ["relay.reviewQueue"],
  ["edge.pair"], ["edge.nudge"], ["edge.ledger"], ["edge.noBeat"],
];

for (const locale of LOCALES.filter((l) => translator(l).has)) {
  const { t } = translator(locale);
  test(`channelsNight.setup (${locale}): every message renders with the values the UI passes`, () => {
    for (const [key, values] of CALLS) {
      const out = t(`channelsNight.setup.${key}`, values);
      assert.ok(out.trim() && !out.includes("channelsNight."), `${locale} setup.${key} is missing`);
      assert.ok(!/[{}]/.test(out), `${locale} setup.${key} left a placeholder: ${out}`);
    }
  });
}

test("the plural and the count land where the reader reads them", () => {
  const { t } = translator("en");
  assert.equal(t("channelsNight.setup.receivers.count", { count: 1 }), "1 receiver · each binds to one role");
  assert.match(t("channelsNight.setup.relay.notSending", { count: 58 }), /58 messages are NOT being sent/);
});

test("every key map the setup reads resolves in en", () => {
  const { t } = translator("en");
  for (const key of [...Object.values(FEED_STATE_KEY), ...Object.values(EDGE_STATUS_KEY)]) assert.ok(!t(key).includes("channels"), key);
});
