// feed-events-speak-your-language — the pipeline activity feed must not fall back to a
// raw English event kind.
//
// The bug this pins: useEventVerb returned `ev.kind.replace(/_/g, " ")` for anything
// outside EVENT_KINDS, and EVENT_KINDS held only the 16 board-lifecycle kinds while the
// feed (listPipelineEvents) renders EVERY pipeline_events row. 34 of the 50 kinds then
// reachable — outreach_sent, offer_drafted, auto_rejected, the alert kinds, every
// dispatched comm — rendered in English no matter the locale.
//
// THE STANDING RULE this file enforces: the catalog key set is DERIVED from the code's
// canonical vocabulary, never enumerated by eye. And it is checked per LOCALE, because
// `npm run i18n:check` only proves the four locales agree with each other — deleting a
// key from ALL FOUR leaves it green (measured this round). Set equality here is what
// catches that.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_CATALOG, EVENT_KINDS, isEventKind } from "./pipelineEventCatalog.ts";
import { AUTOMATION_ALERT_KINDS, DECISION_META } from "@/app/_lib/decision-attribution";
import { ATS_EXPORT_EVENT_KIND } from "@/app/api/ats/candidate/ats-candidate-audit";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const LOCALES = ["en", "cs", "de", "fr"] as const;

const messages = (loc: string) =>
  JSON.parse(readFileSync(resolve(ROOT, `messages/${loc}.json`), "utf8")) as {
    pipeline: { events: Record<string, string> };
  };

// The catalog carries a `<kind>Detail` variant beside a handful of kinds (scored,
// scheduled, …) plus the `unknownKind` degradation frame. Everything else is a kind.
const NON_KIND_KEYS = new Set(["unknownKind"]);
const baseKeys = (loc: string) =>
  Object.keys(messages(loc).pipeline.events).filter((k) => !k.endsWith("Detail") && !NON_KIND_KEYS.has(k));

const kinds = new Set<string>(EVENT_KINDS);

// --- the canonical vocabulary is derived, not typed out ----------------------------

test("EVENT_KINDS covers the whole automation vocabulary (derived from DECISION_META)", () => {
  // DECISION_META is the declared one-source-of-truth for automation event kinds, and
  // decision-attribution.test.ts already pins the writers against it. Deriving from it
  // here means a new automation kind cannot reach the feed without a localized verb.
  const missing = Object.keys(DECISION_META).filter((k) => !kinds.has(k));
  assert.deepEqual(missing, [], "these kinds are in DECISION_META but would render raw in the feed");
});

test("EVENT_KINDS covers the policy-pass alert kinds and the ATS export kind", () => {
  for (const k of AUTOMATION_ALERT_KINDS) assert.ok(kinds.has(k), `${k} is written but not in EVENT_KINDS`);
  assert.ok(kinds.has(ATS_EXPORT_EVENT_KIND), "ATS_EXPORT_EVENT_KIND is written but not in EVENT_KINDS");
});

test("EVENT_KINDS has no duplicates", () => {
  assert.equal(kinds.size, EVENT_KINDS.length);
});

test("every kind carries a glyph (runtime twin of the Record<EventKind,…> compile check)", () => {
  assert.deepEqual(Object.keys(EVENT_CATALOG).sort(), [...EVENT_KINDS].sort());
});

// --- set equality with the i18n catalog, in ALL FOUR locales -----------------------

for (const loc of LOCALES) {
  test(`[${loc}] pipeline.events is set-equal to EVENT_KINDS`, () => {
    const cat = baseKeys(loc);
    const missing = [...kinds].filter((k) => !cat.includes(k));
    const orphan = cat.filter((k) => !kinds.has(k));
    assert.deepEqual(missing, [], `${loc}: kinds with no localized verb — the feed would render raw English`);
    assert.deepEqual(orphan, [], `${loc}: catalog keys that are not event kinds — dead strings`);
  });

  test(`[${loc}] no localized verb is blank, and none is just the raw key`, () => {
    const events = messages(loc).pipeline.events;
    for (const k of kinds) {
      const v = events[k];
      assert.ok(typeof v === "string" && v.trim().length > 0, `${loc}.${k} is empty`);
      assert.notEqual(v, k.replace(/_/g, " "), `${loc}.${k} is the old English fallback, not a translation`);
    }
  });

  test(`[${loc}] the unknown-kind frame exists and shows the raw token`, () => {
    const v = messages(loc).pipeline.events.unknownKind;
    assert.ok(v, `${loc} has no unknownKind frame`);
    assert.match(v, /\{kind\}/, `${loc}.unknownKind must interpolate the raw kind`);
    // …and it must be a FRAME, not just the token: a bare "{kind}" would read exactly
    // like a first-class label, which is the thing this direction set out to kill.
    assert.ok(v.replace("{kind}", "").trim().length > 0, `${loc}.unknownKind is only the raw token`);
  });
}

// --- the degradation path -----------------------------------------------------------

test("an unknown/legacy kind is NOT treated as a first-class kind", () => {
  // isEventKind is the gate useEventVerb reads; a legacy row must fail it and take the
  // localized unknownKind frame instead of resolving a catalog key.
  assert.equal(isEventKind("outreach_sent"), true);
  assert.equal(isEventKind("some_legacy_kind"), false);
  assert.equal(isEventKind(""), false);
});

test("useEventVerb no longer de-underscores a raw English kind", () => {
  const src = readFileSync(resolve(ROOT, "app/features/hiring/pipeline/pipelineEventCatalog.ts"), "utf8");
  assert.doesNotMatch(
    src,
    /ev\.kind\.replace\(/,
    "the raw English fallback is back — an unknown kind must go through t('unknownKind')"
  );
  assert.match(src, /t\("unknownKind", \{ kind: ev\.kind \}\)/);
});
