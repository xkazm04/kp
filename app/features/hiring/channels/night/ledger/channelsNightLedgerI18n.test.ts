// The post book's and the letter's catalog (channelsNight.ledger, channelsNight.message) against the
// CALL SHAPES their components use: every message renders with the values the UI passes, in every
// locale that carries the sub-object (en now; cs / de / fr as the translators land them), the rich
// ones leave no tag behind, and no component of levels 2 / 3 opts out of the hardcoded-string rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { LOCALES, type Locale } from "@/i18n/locales";

type Render = (key: string, values?: Record<string, unknown>) => string;
function translator(locale: Locale): { t: Render; has: (sub: string) => boolean } {
  const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8"));
  const t = createTranslator({ locale, messages }) as unknown as { markup: (k: string, v?: Record<string, unknown>) => string };
  const tags = { b: (c: string) => `[${c}]`, em: (c: string) => `[${c}]` };
  return { t: (k, v) => t.markup(k, { ...tags, ...v }), has: (sub) => Boolean(messages.channelsNight?.[sub]) };
}

const LEDGER: [string, Record<string, unknown>?][] = [
  ["title"], ["lead"], ["chipsLabel"], ["needsYou"], ["notMeasuredTip"], ["notMeasuredNote"], ["relayOffStays"], ["queuedStays"],
  ["scope", { count: 2, channel: "Email intake" }], ["scopeNone", { channel: "Email intake" }], ["showAll"], ["colVerdict"], ["staleRead"],
  ...["rows", "step", "slash", "digits", "row", "search", "verdict"].map((k): [string] => [`keys.${k}`]),
];
const STEPS = ["recorded", "relayed", "deadLettered", "needsYou", "resent", "bounced", "needsAddress", "receiptArrived", "unmatched"];
const MESSAGE: [string, Record<string, unknown>?][] = [
  ...["queued", "sent", "recovered", "failed", "bounced", "orphaned"].map((v): [string] => [`hint.${v}`]),
  ["to"], ["reference"], ["note.queuedNoRelay", { name: "Jana Nováková" }], ["note.queuedLater"],
  ["act.title"], ["act.configureHelp"], ["act.retryHelp"], ["act.correctSubmit"],
  ["timeline.title"], ["timeline.lead"], ["timeline.notYet"], ["timeline.cannot"], ["timeline.noTime"], ["timeline.bounceDetail", { detail: "550" }],
  ...STEPS.flatMap((s): [string][] => [[`timeline.step.${s}.title`], [`timeline.step.${s}.detail`]]),
  ["timeline.step.neverHanded.title"], ["timeline.step.neverHanded.relayOff"], ["timeline.step.neverHanded.relayOn"],
  ["keys.brackets"], ["keys.step"],
];

for (const locale of LOCALES) {
  const { t, has } = translator(locale);
  for (const [sub, keys] of [["ledger", LEDGER], ["message", MESSAGE]] as const) {
    if (!has(sub)) continue;
    test(`channelsNight.${sub} (${locale}): every message renders with the values the UI passes`, () => {
      for (const [key, values] of keys) {
        const out = t(`channelsNight.${sub}.${key}`, values);
        assert.ok(out.trim() && !out.includes("channelsNight."), `${locale} ${sub}.${key} is missing`);
        assert.ok(!out.includes("<") && !out.includes("{"), `${locale} ${sub}.${key} left a tag or a placeholder: ${out}`);
      }
    });
  }
}

test("the letter's loud note puts its first sentence in bold and names the candidate", () => {
  const { t } = translator("en");
  assert.equal(
    t("channelsNight.message.note.queuedNoRelay", { name: "Jana" }),
    "[Nothing left this machine: no relay is configured.] This message is recorded. It is NOT sent to Jana.",
  );
});

test("no component of the post book or the letter opts out of the hardcoded-string rule", () => {
  const dir = path.join(process.cwd(), "app/features/hiring/channels/night");
  for (const sub of ["ledger", "message"]) {
    for (const f of readdirSync(path.join(dir, sub)).filter((x) => x.endsWith(".tsx"))) {
      const src = readFileSync(path.join(dir, sub, f), "utf8");
      assert.doesNotMatch(src, /eslint-disable/, `${sub}/${f} carries a suppression`);
    }
  }
});
