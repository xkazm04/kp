import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createTranslator } from "next-intl";
import { LOCALES, type Locale } from "@/i18n/locales";

// SIM3 — pins the `comms.*` catalog: comms-dispatch loads messages dynamically
// (so its keys type as `never` and the compiler can't check them), so render
// every key with representative values in EVERY locale here. A missing key, a
// renamed key, or a broken ICU placeholder (e.g. an apostrophe that swallows a
// `{slot}`) fails this test instead of shipping a blank/garbled email.
//
// TWO defects this file used to pass through, both now guarded below:
//   • a MISSING key. next-intl returns the key PATH ("comms.ack.bodyEnrich") for a
//     message it cannot find, which is a non-empty string with no `{placeholder}`
//     left in it — so rendering alone was green while `ack.bodyEnrich` and
//     `ack.statusLine` existed in NO locale and the quick-apply acknowledgement
//     email literally read "comms.ack.bodyEnrich". `t.has()` is the real check.
//   • only en+cs were rendered, while the dispatcher serves all four catalogs
//     (a de/fr candidate's letters were unpinned).
// And the key list is now DERIVED FROM THE SOURCE (the comms-envelope.test.ts
// pattern) rather than hand-maintained, so it cannot drift again.

const ROOT = path.join(process.cwd(), "messages");
type Catalog = {
  (key: string, values?: Record<string, string | number>): string;
  has: (key: string) => boolean;
};
function translator(locale: Locale, namespace: string): Catalog {
  const messages = JSON.parse(readFileSync(path.join(ROOT, `${locale}.json`), "utf-8"));
  return createTranslator({ locale, messages, namespace }) as unknown as Catalog;
}


// SOURCE GUARD: every key comms-dispatch.ts renders through its `comms` translator
// (`t("…")`) and its `apply` translator (`ta("…")`) must EXIST in all four catalogs.
const dispatchSrc = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "comms-dispatch.ts"), "utf8");
const keysFor = (fn: string) =>
  new Set([...dispatchSrc.matchAll(new RegExp(`(?<![A-Za-z0-9_])${fn}\\("([A-Za-z0-9_.]+)"`, "g"))].map((m) => m[1]));
const COMMS_KEYS = keysFor("t");
const APPLY_KEYS = keysFor("ta");

test("every catalog key the dispatchers render EXISTS in all four locales", () => {
  // Guard the guard: a rename that stops matching must fail loudly, not pass empty.
  assert.ok(COMMS_KEYS.size >= 30, `expected >=30 rendered comms keys, found ${COMMS_KEYS.size}`);
  assert.ok(APPLY_KEYS.size >= 3, `expected >=3 rendered apply keys, found ${APPLY_KEYS.size}`);
  for (const locale of LOCALES) {
    for (const [namespace, keys] of [
      ["comms", COMMS_KEYS],
      ["apply", APPLY_KEYS],
    ] as const) {
      const t = translator(locale, namespace);
      const missing = [...keys].filter((k) => !t.has(k)).sort();
      assert.deepEqual(missing, [], `${locale}: ${namespace}.* keys rendered by comms-dispatch but absent: ${missing.join(", ")}`);
    }
  }
});

// (key, values) the dispatchers actually pass — kept in lockstep with
// comms-dispatch.ts so the test exercises real call shapes.
const RENDERS: [string, Record<string, string | number>][] = [
  ["team", {}],
  ["there", {}],
  ["theRole", {}],
  ["aRole", {}],
  ["yourNewRole", {}],
  ["dataFooter", { link: "https://x/data/er-1" }],
  // The intake-ack key set distribution.ts owns; comms-dispatch composes the same one.
  ["ack.subject", {}],
  ["ack.subjectRole", { role: "Backend Engineer" }],
  ["ack.greeting", { name: "Jane" }],
  ["ack.body", {}],
  ["ack.bodyRole", { role: "Backend Engineer" }],
  ["ack.signoff", {}],
  ["outreach.subjectFallback", { role: "Backend Engineer" }],
  ["rejection.subject", { role: "Backend Engineer" }],
  ["rejection.opening", { name: "Jane", role: "Backend Engineer" }],
  ["rejection.early", {}],
  ["rejection.standard", {}],
  ["rejection.feedbackIntro", {}],
  ["rejection.feedbackOutro", {}],
  ["rejection.closing", { team: "The hiring team" }],
  ["koDecline.subject", { role: "Backend Engineer" }],
  ["koDecline.body", { name: "Jane", role: "Backend Engineer", team: "The hiring team" }],
  ["offer.subjectFallback", { role: "Backend Engineer" }],
  ["offer.deadlineLine", { deadline: "Jun 21, 5:00 PM" }],
  ["offer.startLine", { date: "1 Sep 2026" }],
  ["offer.responseFooter", { link: "https://x/offer/abc" }],
  ["scheduleInvite.subject", { role: "Backend Engineer" }],
  ["scheduleInvite.length", { minutes: 22 }],
  ["scheduleInvite.body", { name: "Jane", role: "Backend Engineer", link: "https://x/schedule/abc", length: " (22m)", team: "The hiring team" }],
  ["interviewConfirmation.subject", { role: "Backend Engineer" }],
  ["interviewConfirmation.length", { minutes: 22 }],
  ["interviewConfirmation.linkFooter", { link: "https://x/schedule/abc" }],
  ["interviewConfirmation.short", { name: "Jane", role: "Backend Engineer", slot: "Mon 10:00", length: " (22m)", team: "The hiring team" }],
  ["interviewConfirmation.normal", { name: "Jane", role: "Backend Engineer", slot: "Mon 10:00", length: " (22m)", team: "The hiring team" }],
  ["interviewReminder.subject", { slot: "Mon 10:00" }],
  ["interviewReminder.length", { minutes: 22 }],
  ["interviewReminder.body", { name: "Jane", role: "Backend Engineer", slot: "Mon 10:00", length: " (22m)", team: "The hiring team" }],
  ["interviewerBrief.subject", { candidate: "Jane", role: "Backend Engineer" }],
  ["interviewerBrief.length", { minutes: 22 }],
  ["interviewerBrief.focusFallback", {}],
  ["interviewerBrief.scenarioFallback", {}],
  ["interviewerBrief.icsTitle", { candidate: "Jane", role: "Backend Engineer" }],
  ["interviewerBrief.calendarHeader", {}],
  ["interviewerBrief.body", { name: "Alice", candidate: "Jane", role: "Backend Engineer", slot: "Mon 10:00", length: " (~22 min)", scenario: "A 30-minute structured interview.", focus: "Go, k8s" }],
  ["offerReminder.subject", { role: "Backend Engineer" }],
  ["offerReminder.body", { name: "Jane", role: "Backend Engineer", deadline: "Jun 21, 5:00 PM", link: "https://x/offer/abc", team: "The hiring team" }],
  ["interviewInvite.subject", { role: "Backend Engineer" }],
  ["interviewInvite.length", { minutes: 22 }],
  ["interviewInvite.body", { name: "Jane", role: "Backend Engineer", link: "https://x/i/abc", length: " (22m)", team: "The hiring team" }],
];

// The link labels the acknowledgement borrows from the candidate-facing apply page.
const APPLY_RENDERS: [string, Record<string, string | number>][] = [
  ["trackStatus", {}],
  ["quick.enrichCta", {}],
  ["quick.enrichNote", {}],
];

for (const locale of LOCALES) {
  test(`comms catalog renders every key in ${locale}`, () => {
    const t = translator(locale, "comms");
    for (const [key, values] of RENDERS) {
      const out = t(key, values);
      assert.equal(typeof out, "string", `${locale} ${key} should render a string`);
      assert.ok(out.length > 0, `${locale} ${key} should be non-empty`);
      // No unresolved ICU placeholder should survive (would mean a values mismatch).
      assert.ok(!/\{[a-zA-Z]+\}/.test(out), `${locale} ${key} left an unresolved placeholder: ${out}`);
    }
  });
}

for (const locale of LOCALES) {
  test(`apply catalog renders the acknowledgement link labels in ${locale}`, () => {
    const ta = translator(locale, "apply");
    for (const [key, values] of APPLY_RENDERS) {
      const out = ta(key, values);
      assert.ok(out.length > 0 && !/\{[a-zA-Z]+\}/.test(out), `${locale} apply.${key} rendered "${out}"`);
    }
  });
}

test("interpolated slot survives the apostrophe-heavy confirmation body", () => {
  const t = translator("en", "comms");
  const out = t("interviewConfirmation.short", { name: "Jane", role: "BE", slot: "Mon 10:00", length: "", team: "Team" });
  assert.match(out, /Mon 10:00/);
});
