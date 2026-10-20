// The Night Post's catalog against the CALL SHAPES its components use: every need, fact, chip and
// figure is RENDERED with the values the UI passes (a dropped placeholder or rich tag renders a hole
// ICU will not complain about), in every locale that carries the namespace (en now; cs / de / fr
// join as the translators land them). The copy maps (channelsNightCopy.ts) must resolve in en.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { LOCALES, type Locale } from "@/i18n/locales";
import { BACKLOG_KEY, CHANNEL_BLURB, CHIP_KEY, DRAIN_FAIL_KEY, NODE_NAME } from "./channelsNightCopy.ts";

type Render = (key: string, values?: Record<string, unknown>) => string;
function translator(locale: Locale): { t: Render; has: boolean } {
  const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8"));
  const t = createTranslator({ locale, messages }) as unknown as { markup: (k: string, v?: Record<string, unknown>) => string };
  return { t: (k, v) => t.markup(k, { em: (c: string) => `[${c}]`, ...v }), has: Boolean(messages.channelsNight) };
}

const NEEDS: [string, Record<string, unknown>][] = [
  ["relayOffQueued", { count: 24 }], ["relayOff", {}], ["relayUnreadable", { queued: 3 }], ["dead", { count: 8, failed: 4, bounced: 4 }],
  ["pullFailing", { role: "Data Engineer" }], ["edgeFailing", {}], ["edgeSecretMissing", {}], ["orphaned", { count: 3 }],
  ["reachedNoLeads", { role: "Data Engineer", count: 12 }], ["queuedWithRelay", { count: 4 }], ["edgeOff", {}], ["edgePending", { count: 3 }],
  ["nothingPublished", {}], ["receiverWaiting", { role: "Data Engineer" }],
];
const FACTS: [string, Record<string, unknown>][] = [
  ["careersRoles", { count: 8 }], ["careersNone", {}], ["emailNone", {}], ["adsNone", {}], ["receiversNothing", { count: 2 }],
  ["receiversTraffic", { count: 3, received: 117, filed: 46 }], ["feedsNone", {}], ["feedsFailing", { failing: 1, count: 3 }],
  ["feedsNotPulled", {}], ["feedsPulling", { count: 2, time: "5 min ago" }], ["relayQueuedNotSent", { queued: 24 }],
  ["relayNothingDeliverable", {}], ["relayTraffic", { sent: 31, needs: 8, queued: 4 }], ["relayNoSendYet", {}], ["relayOutboxOnly", {}],
  ["edgeNobody", {}], ["edgeOfflineFact", {}], ["edgeSecretFact", {}], ["edgeNeverDrainedFact", {}],
  ["edgeBeat", { time: "2 min ago", backlog: "nothing waiting" }], ["edgeNoBeat", { backlog: "nothing waiting" }],
  ["bookNoneSentFact", { total: 24 }], ["bookTraffic", { total: 46, sent: 31, orphaned: 3 }], ["bookEmptyFact", {}], ["olderExist", {}],
];

// Only the locales that carry the namespace: a catalog the translators have not reached yet is
// i18n-check's gap to report, not this test's.
for (const locale of LOCALES.filter((l) => translator(l).has)) {
  const { t } = translator(locale);
  test(`channelsNight (${locale}): every need, fact and figure renders with the values the UI passes`, () => {
    const out = (k: string, v?: Record<string, unknown>) => {
      const s = t(`channelsNight.${k}`, v);
      assert.ok(s.trim() && !s.includes("channelsNight."), `${locale} ${k} is missing`);
      return s;
    };
    for (const [key, v] of NEEDS) {
      out(`plumbing.need.${key}.title`, v);
      out(`plumbing.need.${key}.detail`, v);
      out(`plumbing.need.${key}.cta`);
    }
    out("plumbing.need.dead.detailFailed", { failed: 2 });
    out("plumbing.need.dead.detailBounced", { bounced: 2 });
    for (const [key, v] of FACTS) out(`plumbing.fact.${key}`, v);
    for (const k of ["waiting", "waitingNote", "messages", "noneSent", "newestPage", "dead", "deadNote", "notRead", "notMeasured"]) out(`plumbing.figures.${k}`);
    out("plumbing.figures.sent", { count: 3 });
    for (const k of ["reading", "ok", "okSub", "okPartial", "okPartialSub", "quiet"]) out(`plumbing.headline.${k}`);
    for (const relay of ["proven", "unproven"]) for (const off of [0, 1, 3, 5]) out("plumbing.headline.quietSub", { relay, off });
    out("shell.back", { place: "Ledger" });
    out("shell.channelPosition", { index: 1, total: 6 });
    out("shell.messagePosition", { index: 2, total: 58 });
  });
}

test("the counts wear the pill, and a zero drops its clause instead of printing it", () => {
  const { t } = translator("en");
  assert.equal(t("channelsNight.plumbing.need.relayOffQueued.title", { count: 24 }), "[24 messages] are NOT being sent to candidates");
  assert.equal(t("channelsNight.plumbing.need.relayOffQueued.title", { count: 1 }), "[1 message] is NOT being sent to candidates");
  assert.equal(t("channelsNight.plumbing.fact.relayTraffic", { sent: 5, needs: 0, queued: 0 }), "5 sent");
  assert.equal(t("channelsNight.plumbing.fact.bookTraffic", { total: 5, sent: 5, orphaned: 0 }), "5 messages · 5 sent");
});

test("the quiet headline never claims delivery it has no evidence for", () => {
  const { t } = translator("en");
  const unproven = t("channelsNight.plumbing.headline.quietSub", { relay: "unproven", off: 5 });
  assert.ok(!/delivers|flowing|open/i.test(unproven), unproven);
  assert.equal(unproven, "The relay is set up but has not sent anything yet, so delivery is not proven. 5 channels are off or not set up.");
  assert.equal(t("channelsNight.plumbing.headline.quietSub", { relay: "proven", off: 1 }), "The relay has delivered mail. One channel is off or not set up.");
});

test("every copy map resolves to a real message in en", () => {
  const { t } = translator("en");
  for (const key of [...Object.values(NODE_NAME), ...Object.values(CHANNEL_BLURB), ...Object.values(DRAIN_FAIL_KEY)]) {
    assert.ok(!t(key).includes("channels"), key);
  }
  for (const key of [...Object.values(CHIP_KEY), ...Object.values(BACKLOG_KEY)]) assert.ok(t(key, { count: 2, pending: 2 }).trim(), key);
});
