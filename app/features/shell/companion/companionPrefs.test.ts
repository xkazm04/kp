// Pure unit coverage for the companion presentation preferences (round V2): the
// tolerant coerce and the localStorage-string parse. No React, no DOM, no
// storage — runs under `node --test` via the alias loader.
//
// The coerce is the interesting half. It is total by contract, and the contract
// is FIELD BY FIELD: a store carrying one good field and one bad one must keep
// the good one, because the alternative (drop the object, take every default)
// silently moves the operator back to the window they had left.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_COMPANION_PREFS,
  coerceCompanionPrefs,
  isCompanionUiMode,
  isCompanionVoiceVariant,
  parseStoredPrefs,
} from "./companionPrefs.ts";

test("defaults: the window, silent, on the first direction", () => {
  assert.deepEqual(DEFAULT_COMPANION_PREFS, { mode: "dock", autoSpeak: false, variant: "ticker" });
});

test("coerce: a full, valid object round-trips unchanged", () => {
  const prefs = { mode: "voice", autoSpeak: true, variant: "hud" };
  assert.deepEqual(coerceCompanionPrefs(prefs), prefs);
});

test("coerce: null / a primitive / an array of nothing useful -> the defaults", () => {
  assert.deepEqual(coerceCompanionPrefs(null), DEFAULT_COMPANION_PREFS);
  assert.deepEqual(coerceCompanionPrefs("voice"), DEFAULT_COMPANION_PREFS);
  assert.deepEqual(coerceCompanionPrefs(42), DEFAULT_COMPANION_PREFS);
  assert.deepEqual(coerceCompanionPrefs(undefined), DEFAULT_COMPANION_PREFS);
  // An array IS an object; every field is absent, so every field defaults.
  assert.deepEqual(coerceCompanionPrefs([]), DEFAULT_COMPANION_PREFS);
});

test("coerce: one bad field does NOT cost the good ones", () => {
  assert.deepEqual(coerceCompanionPrefs({ mode: "voice", autoSpeak: "yes", variant: "stage" }), {
    mode: "voice",
    autoSpeak: false,
    variant: "stage",
  });
  assert.deepEqual(coerceCompanionPrefs({ mode: "cockpit", autoSpeak: true, variant: "stage" }), {
    mode: "dock",
    autoSpeak: true,
    variant: "stage",
  });
});

test("coerce: a partial store (last version's shape) fills only what is missing", () => {
  assert.deepEqual(coerceCompanionPrefs({ mode: "voice" }), {
    mode: "voice",
    autoSpeak: false,
    variant: "ticker",
  });
});

test("coerce: autoSpeak is a strict boolean — 0/1 and \"true\" are not booleans", () => {
  assert.equal(coerceCompanionPrefs({ autoSpeak: 1 }).autoSpeak, false);
  assert.equal(coerceCompanionPrefs({ autoSpeak: "true" }).autoSpeak, false);
  assert.equal(coerceCompanionPrefs({ autoSpeak: true }).autoSpeak, true);
  assert.equal(coerceCompanionPrefs({ autoSpeak: false }).autoSpeak, false);
});

test("parseStoredPrefs: absent / corrupt JSON -> defaults, never a throw", () => {
  assert.deepEqual(parseStoredPrefs(null), DEFAULT_COMPANION_PREFS);
  assert.deepEqual(parseStoredPrefs(""), DEFAULT_COMPANION_PREFS);
  assert.deepEqual(parseStoredPrefs("{not json"), DEFAULT_COMPANION_PREFS);
  assert.deepEqual(parseStoredPrefs("null"), DEFAULT_COMPANION_PREFS);
});

test("parseStoredPrefs: a real stored string comes back as the same preferences", () => {
  const prefs = { mode: "voice" as const, autoSpeak: true, variant: "stage" as const };
  assert.deepEqual(parseStoredPrefs(JSON.stringify(prefs)), prefs);
});

test("guards: the taxonomies are closed", () => {
  assert.ok(isCompanionUiMode("dock") && isCompanionUiMode("voice"));
  assert.ok(!isCompanionUiMode("Voice") && !isCompanionUiMode(null) && !isCompanionUiMode(""));
  assert.ok(isCompanionVoiceVariant("ticker") && isCompanionVoiceVariant("stage") && isCompanionVoiceVariant("hud"));
  assert.ok(!isCompanionVoiceVariant("strip") && !isCompanionVoiceVariant(0));
});
