// channels-i18n-honesty — pins the `channels.*` catalog against the CALL SHAPES the
// Channels surface actually uses, in every locale.
//
// The tab and the Comms Center were hardcoded English behind six
// `eslint-disable i18next/no-literal-string` comments while ~49 already-translated
// channels.* keys sat orphaned. Now that the surface renders from the catalog, two
// classes of regression are possible and invisible to `tsc`:
//   · a message that drops a placeholder or a rich tag the component passes (a blank
//     endpoint chip, a missing role name) — ICU renders happily and the recruiter sees
//     a hole. So every message is RENDERED here with the real values/tags, ×4 locales.
//   · a literal creeping back in. The six files are held at ESLint `error` now; this
//     also fails if a disable comment reappears.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createTranslator } from "next-intl";
import { LOCALES, type Locale } from "@/i18n/locales";
import { CHANNEL_EMPTY_SPECS } from "./channelsEmptySpecs";

const dir = path.dirname(fileURLToPath(import.meta.url));

type Rich = (key: string, values?: Record<string, unknown>) => unknown;
function translator(locale: Locale): { plain: Rich; rich: Rich } {
  const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8"));
  const t = createTranslator({ locale, messages, namespace: "channels" }) as unknown as {
    (key: string, values?: Record<string, unknown>): string;
    rich: (key: string, values?: Record<string, unknown>) => unknown;
  };
  return { plain: (k, v) => t(k, v), rich: (k, v) => t.rich(k, v) };
}

// Tag handlers stand in for the components' <b>/<i>/<code>/endpoint renderers.
const chunks = (c: unknown) => String(c ?? "");
const TAGS = { b: chunks, i: chunks, code: chunks, endpoint: () => "hook_x@inbound.example.cz" };

// (key, values) exactly as the components call them — kept in lockstep with
// ChannelsTab / EmailIntakeWizard / AdFormsPane / CvSimCard / channel-receivers /
// SetupGuide / CommsTable. The column-filter and pager copy moved OUT of this
// namespace with the primitives themselves (app/_components/table/*) and is pinned
// the same way in app/_components/table/table-i18n.test.ts.
const PLAIN: [string, Record<string, unknown>][] = [
  ["eyebrow", {}],
  ["title", {}],
  ["tablist", {}],
  ["waiting", { count: 4 }],
  ["ledger", {}],
  ["statusLive", {}],
  ["statusListening", {}],
  ["statusConfigured", {}],
  ["statusOff", {}],
  ["statusNothingPublished", {}],
  ["statusWaiting", {}],
  ["copy", {}],
  ["copied", {}],
  ["copyLink", {}],
  ["stats.publishedRoles", {}],
  ["stats.waiting", {}],
  ["stats.receivers", {}],
  ["stats.received", {}],
  ["stats.leads", {}],
  ["sim.run", {}],
  ["sim.running", {}],
  ["sim.noJob", {}],
  ["sim.filed", { label: "Jana Nová", score: 71, role: "Backend Engineer (SIM)" }],
  ["sim.failed", {}],
  ["careers.empty", {}],
  ["careers.applyLink", {}],
  ["careers.publishRole", {}],
  ["receivers.role", {}],
  ["receivers.lang", {}],
  ["receivers.status", {}],
  ["receivers.received", {}],
  ["receivers.receivedHint", {}],
  ["receivers.copyEndpoint", {}],
  ["receivers.remove", {}],
  ["receivers.removeAria", { role: "Backend Engineer" }],
  ["receivers.confirmTitle", {}],
  ["receivers.cancel", {}],
  ["receivers.confirm", {}],
  ["add.roleLabel", {}],
  ["add.rolePlaceholder", {}],
  ["add.langLabel", {}],
  ["add.noJobs", {}],
  ["add.noJobsCta", {}],
  ["add.cancel", {}],
  ["add.create", {}],
  ["add.creating", {}],
  ["add.createFailed", {}],
  ["add.removeFailed", {}],
  ["email.title", {}],
  ["email.add", {}],
  ["email.emptyWired", {}],
  ["email.emptyUnwired", {}],
  ["email.endpointWired", {}],
  ["email.endpointUnwired", {}],
  ["email.waiting", {}],
  ["email.notWiredTitle", {}],
  ["ads.title", {}],
  ["ads.add", {}],
  ["ads.empty", {}],
  ["ads.endpoint", {}],
  ["ads.waiting", {}],
  ["guide.setupFor", {}],
  ["guide.live", {}],
  ["cvSim.open", {}],
  ["cvSim.title", {}],
  ["cvSim.close", {}],
  ["cvSim.choose", {}],
  ["cvSim.namePlaceholder", {}],
  ["cvSim.emailPlaceholder", {}],
  ["cvSim.run", {}],
  ["cvSim.running", {}],
  ["cvSim.hint", {}],
  ["cvSim.failed", { reason: "Job not found." }],
  ["cvSim.failedStatus", { status: 500 }],
  ["cvSim.requestFailed", {}],
  ["cvSim.stub", {}],
  ["cvSim.openInPipeline", {}],
  // Intake-brief empty states (channels.empty.*, keys carried by channelsEmptySpecs).
  ["empty.notConnected", {}],
  ["empty.connectedIdle", {}],
  // Comms Center chrome (rendered from the channels.comms sub-namespace).
  ["comms.colName", {}],
  ["comms.colRole", {}],
  ["comms.colChannel", {}],
  ["comms.colType", {}],
  ["comms.colStatus", {}],
  ["comms.colRecorded", {}],
  ["comms.recordedHint", {}],
  ["comms.via", { channel: "Webhook" }],
  ["comms.statusSent", {}],
  ["comms.statusQueued", {}],
  ["comms.statusFailed", {}],
  ["comms.statusRecovered", {}],
  ["comms.statusBounced", {}],
  ["comms.orphanBadge", {}],
  ["comms.orphanHint", {}],
  ["comms.failureDetail", { detail: "550 5.1.1 unknown recipient" }],
  ["comms.failureDetailUnknown", {}],
  ["comms.resendRejected", { reason: "No deliverable address." }],
  ["comms.resendDeadLettered", {}],
];

const RICH: [string, Record<string, unknown>][] = [
  ["receivers.confirmBody", { ...TAGS, role: "Backend Engineer", endpoint: "Receiver URL" }],
  ["receivers.confirmLive", { count: 1, ...TAGS }],
  ["receivers.confirmLive", { count: 5, ...TAGS }],
  ["email.introWired", { ...TAGS }],
  ["email.introUnwired", { ...TAGS }],
  ["email.lead", { role: "Backend Engineer", ...TAGS }],
  ["email.notWiredBody", { role: "Backend Engineer", ...TAGS }],
  ["email.notWiredHowTo", { ...TAGS }],
  ["email.gmail1", { ...TAGS }],
  ["email.gmail2", { ...TAGS }],
  ["email.gmail3", { ...TAGS }],
  ["email.gmail4", { ...TAGS }],
  ["email.outlook1", { ...TAGS }],
  ["email.outlook2", { ...TAGS }],
  ["email.outlook3", { ...TAGS }],
  ["email.outlook4", { ...TAGS }],
  ["ads.intro", { ...TAGS }],
  ["ads.lead", { role: "Backend Engineer", ...TAGS }],
  ["ads.footnote", { ...TAGS }],
  ["ads.linkedin1", { ...TAGS }],
  ["ads.linkedin2", { ...TAGS }],
  ["ads.linkedin3", { ...TAGS }],
  ["ads.linkedin4", { ...TAGS }],
  ["ads.meta1", { ...TAGS }],
  ["ads.meta2", { ...TAGS }],
  ["ads.meta3", { ...TAGS }],
  ["ads.meta4", { ...TAGS }],
  ["cvSim.landed", { name: "Jana Nová", role: "Backend Engineer", suffix: ".", ...TAGS }],
];

const SECTION_IDS = ["comms", "careers", "email", "ads"] as const;

// Pinned against the real spec table rather than a copy of it: if a spec ever names
// a key the catalogs don't carry, this fails instead of shipping a raw key to a
// recruiter. (channelsEmptySpecs is pure + locale-free, so importing it is free.)
const EMPTY_KEYS = Object.values(CHANNEL_EMPTY_SPECS).flatMap((s) => [
  s.promise,
  s.proof,
  s.actionHint,
  ...s.steps,
  s.effort,
  s.waiting,
]);

for (const locale of LOCALES) {
  test(`channels catalog (${locale}): every plain message renders with the values the UI passes`, () => {
    const { plain } = translator(locale);
    for (const [key, values] of PLAIN) {
      const out = String(plain(key, values));
      assert.ok(out.trim().length > 0, `${locale} channels.${key} rendered empty`);
      assert.ok(!out.includes("channels."), `${locale} channels.${key} is missing (next-intl echoed the key): ${out}`);
    }
  });

  test(`channels catalog (${locale}): every rich message renders its tags and placeholders`, () => {
    const { rich } = translator(locale);
    for (const [key, values] of RICH) {
      const parts = rich(key, values);
      const out = (Array.isArray(parts) ? parts.join("") : String(parts)).trim();
      assert.ok(out.length > 0, `${locale} channels.${key} rendered empty`);
      assert.ok(!out.includes("<"), `${locale} channels.${key} left an unhandled tag: ${out}`);
    }
  });

  test(`channels catalog (${locale}): every section tab has a label and a blurb`, () => {
    const { plain } = translator(locale);
    for (const id of SECTION_IDS) {
      for (const field of ["label", "blurb"] as const) {
        const out = String(plain(`sections.${id}.${field}`));
        assert.ok(out.trim().length > 0 && !out.includes("channels."), `${locale} sections.${id}.${field} missing`);
      }
    }
  });

  test(`channels catalog (${locale}): every empty-state spec key resolves to real copy`, () => {
    const { plain } = translator(locale);
    for (const key of EMPTY_KEYS) {
      const out = String(plain(`empty.${key}`));
      assert.ok(out.trim().length > 0, `${locale} channels.empty.${key} rendered empty`);
      assert.ok(!out.includes("channels."), `${locale} channels.empty.${key} is missing (next-intl echoed the key): ${out}`);
    }
  });
}

test("no prototype-stage literal-string disable survives on the Channels surface", () => {
  // The Jul-28 restructure re-prefixed these files by area and SPLIT the tab and the
  // Comms ledger into children — the guarantee is per SURFACE, so every child that
  // now owns a piece of that markup is held to it too.
  const files = [
    "ChannelsTab.tsx",
    "ChannelsTabStage.tsx",
    "ChannelsTabSwitcher.tsx",
    "ChannelsTabWidgets.tsx",
    "ChannelsEmailIntakeWizard.tsx",
    "ChannelsAdFormsPane.tsx",
    "ChannelsCvSimCard.tsx",
    "ChannelsReceiverTable.tsx",
    "ChannelsAddReceiverModal.tsx",
    "ChannelsCommsTable.tsx",
    "ChannelsCommsRows.tsx",
    "ChannelsCommsMessageModal.tsx",
    "ChannelsCommsBouncedResend.tsx",
    "ChannelsSetupGuide.tsx",
    "ChannelsEmpty.tsx",
  ];
  for (const f of files) {
    const src = readFileSync(path.join(dir, f), "utf8");
    assert.doesNotMatch(src, /eslint-disable[^\n]*i18next/, `${f} still opts out of the hardcoded-string rule`);
  }
});
