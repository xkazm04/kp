// One authority per vocabulary: every closed id /one renders has its words in the
// catalogs, the companion ids /one restates still exist in the real catalog, and the
// panel read parsers fold what the routes return (and refuse what they do not).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CHANGE_KEYS, CHIP_IDS, PANEL_KINDS, SAY_KEYS, VARIANT_IDS, variantOf } from "./types.ts";
import { COMPANION_ACTION_IDS } from "./consent/acts.ts";
import { parsePipeline, sliceEntries } from "./panels/pipelineRead.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const core = (locale: string) => JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")).one.core;

test("every say key, chip, change key, panel and variant has words in all four locales", () => {
  for (const locale of ["en", "cs", "de", "fr"]) {
    const c = core(locale);
    for (const k of SAY_KEYS) assert.equal(typeof c.say[k], "string", `${locale} say.${k}`);
    for (const k of CHIP_IDS) assert.equal(typeof c.chips[k], "string", `${locale} chips.${k}`);
    for (const k of CHANGE_KEYS) assert.equal(typeof c.change[k], "string", `${locale} change.${k}`);
    for (const k of PANEL_KINDS) assert.equal(typeof c.panels[k].title, "string", `${locale} panels.${k}.title`);
    for (const k of VARIANT_IDS) assert.equal(typeof c.meta.variants[k], "string", `${locale} variants.${k}`);
    for (const k of COMPANION_ACTION_IDS) assert.equal(typeof c.consent.companion.title[k], "string", `${locale} companion.${k}`);
  }
});

test("the companion ids /one restates are still the real catalog's ids", () => {
  const src = readFileSync(path.join(ROOT, "app", "_lib", "companion-actions.ts"), "utf8");
  const real = [...src.matchAll(/^\s{4}id: "([a-z_]+)",$/gm)].map((m) => m[1]).sort();
  assert.deepEqual([...COMPANION_ACTION_IDS].sort(), real);
});

test("?v= falls back to greet", () => {
  assert.equal(variantOf("stage"), "stage");
  assert.equal(variantOf("nope"), "greet");
  assert.equal(variantOf(undefined), "greet");
});

test("the pipeline parser keeps active entries only, refuses a body it does not know", () => {
  assert.equal(parsePipeline(null), null);
  assert.equal(parsePipeline({ error: "x" }), null);
  const now = Date.parse("2026-11-07T00:00:00Z");
  const read = parsePipeline(
    {
      entries: [
        { id: "a", candidateLabel: "Ana", jobTitle: "Backend Engineer", stage: "Accepted", status: "active", stageChangedAt: "2026-11-06T00:00:00Z", matchScore: 80 },
        { id: "b", candidateLabel: "Ben", jobTitle: "Designer", stage: "Screened", status: "active", stageChangedAt: "2026-01-01T00:00:00Z", canonicalScore: 55, approvalKind: "screening_review" },
        { id: "c", candidateLabel: "Cy", jobTitle: "Designer", stage: "Screened", status: "rejected" },
      ],
    },
    now
  );
  assert.ok(read);
  assert.deepEqual(read.entries.map((e) => e.id), ["a", "b"]);
  assert.equal(read.entries[1].score, 55, "the canonical score wins over the snapshot");
  assert.deepEqual(sliceEntries(read.entries, { role: "backend" }).map((e) => e.id), ["a"]);
  assert.deepEqual(sliceEntries(read.entries, { filter: "new" }).map((e) => e.id), ["a"]);
  assert.deepEqual(sliceEntries(read.entries, { filter: "aging" }).map((e) => e.id), ["b"]);
});
