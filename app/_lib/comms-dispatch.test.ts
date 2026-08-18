import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";

// SIM3 — pins the `comms.*` catalog: comms-dispatch loads messages dynamically
// (so its keys type as `never` and the compiler can't check them), so render
// every key with representative values in BOTH locales here. A missing key, a
// renamed key, or a broken ICU placeholder (e.g. an apostrophe that swallows a
// `{slot}`) fails this test instead of shipping a blank/garbled email.

const ROOT = path.join(process.cwd(), "messages");
function translator(locale: "en" | "cs") {
  const messages = JSON.parse(readFileSync(path.join(ROOT, `${locale}.json`), "utf-8"));
  return createTranslator({ locale, messages, namespace: "comms" }) as unknown as (
    key: string,
    values?: Record<string, string | number>
  ) => string;
}

// (key, values) the dispatchers actually pass — kept in lockstep with
// comms-dispatch.ts so the test exercises real call shapes.
const RENDERS: [string, Record<string, string | number>][] = [
  ["team", {}],
  ["there", {}],
  ["theRole", {}],
  ["aRole", {}],
  ["yourNewRole", {}],
  ["ack.subject", { role: "Backend Engineer" }],
  ["ack.body", { name: "Jane", role: "Backend Engineer", team: "The hiring team" }],
  ["ack.bodyEnrich", { name: "Jane", role: "Backend Engineer", link: "https://x/apply/job-1?lang=en", team: "The hiring team" }],
  ["outreach.subjectFallback", { role: "Backend Engineer" }],
  ["rejection.subject", { role: "Backend Engineer" }],
  ["rejection.opening", { name: "Jane", role: "Backend Engineer" }],
  ["rejection.early", {}],
  ["rejection.standard", {}],
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

for (const locale of ["en", "cs"] as const) {
  test(`comms catalog renders every key in ${locale}`, () => {
    const t = translator(locale);
    for (const [key, values] of RENDERS) {
      const out = t(key, values);
      assert.equal(typeof out, "string", `${locale} ${key} should render a string`);
      assert.ok(out.length > 0, `${locale} ${key} should be non-empty`);
      // No unresolved ICU placeholder should survive (would mean a values mismatch).
      assert.ok(!/\{[a-zA-Z]+\}/.test(out), `${locale} ${key} left an unresolved placeholder: ${out}`);
    }
  });
}

test("interpolated slot survives the apostrophe-heavy confirmation body", () => {
  const t = translator("en");
  const out = t("interviewConfirmation.short", { name: "Jane", role: "BE", slot: "Mon 10:00", length: "", team: "Team" });
  assert.match(out, /Mon 10:00/);
});
