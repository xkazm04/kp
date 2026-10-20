// Pins the reviewer's per-person exclusions from a screening wave (challenge-r02
// decisions-screen-wave-logic/B): the request field's normalisation, the rule that a
// spare can only NARROW the reject set, and the vocabulary the exclusion is recorded
// under (reason code in every catalog, a HUMAN event kind in both registries).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { effectiveSpare, normalizeSpareList, spareSuffix, SPARE_MAX } from "./screen-wave-spare.ts";
import { DECISION_META } from "./decision-attribution.ts";
import { EVENT_CATALOG, EVENT_KINDS } from "@/app/features/hiring/pipeline/pipelineEventCatalog.ts";

test("normalizeSpareList trims, drops blanks, de-duplicates and sorts", () => {
  assert.deepEqual(normalizeSpareList(["b", "a", "a", "  "]), { ok: true, ids: ["a", "b"] });
  assert.deepEqual(normalizeSpareList([" c "]), { ok: true, ids: ["c"] });
  // Absent = no exclusions: an old client that never sends the field is unchanged.
  assert.deepEqual(normalizeSpareList(undefined), { ok: true, ids: [] });
  assert.deepEqual(normalizeSpareList([]), { ok: true, ids: [] });
});

test("normalizeSpareList refuses anything that is not a bounded list of ids", () => {
  assert.equal(normalizeSpareList({}).ok, false);
  assert.equal(normalizeSpareList([1]).ok, false);
  assert.equal(normalizeSpareList("a").ok, false);
  assert.equal(normalizeSpareList(null).ok, false);
  assert.equal(normalizeSpareList(new Array(SPARE_MAX + 1).fill("x")).ok, false, "the cap counts the raw list");
  assert.equal(normalizeSpareList(new Array(SPARE_MAX).fill(0).map((_, i) => `e${i}`)).ok, true);
});

test("effectiveSpare keeps only ids that would really be rejected, sorted", () => {
  assert.deepEqual(effectiveSpare(new Set(["x", "y"]), ["z", "y", "q"]), ["y"]);
  assert.deepEqual(effectiveSpare(new Set(["x"]), []), []);
  assert.deepEqual(effectiveSpare(["b", "a"], ["b", "a"]), ["a", "b"]);
});

test("an empty effective spare adds nothing to the policyVersion", () => {
  assert.equal(spareSuffix([]), "");
  assert.equal(spareSuffix(["a"]), "/spared1");
  assert.equal(spareSuffix(["a", "b"]), "/spared2");
});

test("recruiterSpared has its reason line in all four catalogs", () => {
  for (const loc of ["en", "cs", "de", "fr"]) {
    const m = JSON.parse(readFileSync(new URL(`../../messages/${loc}.json`, import.meta.url), "utf8")) as {
      decisions: { wave: { reasons: Record<string, string> } };
      pipeline: { events: Record<string, string> };
      analytics: { log: { kinds: Record<string, string> } };
    };
    assert.ok(m.decisions.wave.reasons.recruiterSpared, `${loc}: decisions.wave.reasons.recruiterSpared`);
    assert.ok(m.pipeline.events.screen_wave_recruiter_spared, `${loc}: pipeline.events.screen_wave_recruiter_spared`);
    assert.ok(m.analytics.log.kinds.screen_wave_recruiter_spared, `${loc}: analytics.log.kinds.screen_wave_recruiter_spared`);
  }
});

test("screen_wave_recruiter_spared is a HUMAN event in the feed and the decision log", () => {
  assert.ok((EVENT_KINDS as readonly string[]).includes("screen_wave_recruiter_spared"));
  assert.ok(EVENT_CATALOG["screen_wave_recruiter_spared" as (typeof EVENT_KINDS)[number]]);
  const meta = DECISION_META.screen_wave_recruiter_spared;
  assert.ok(meta, "mapped in DECISION_META");
  assert.equal(meta.auto, false, "a reviewer's exclusion is a person's act, never AUTO");
});
