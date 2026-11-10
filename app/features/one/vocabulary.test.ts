// One authority per vocabulary: every closed id /one renders has its words in the
// catalogs, the companion ids /one restates still exist in the real catalog, and the
// panel read parsers fold what the routes return (and refuse what they do not).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CHANGE_KEYS, CHIP_IDS, PANEL_KINDS, SAY_KEYS } from "./types.ts";
import { SHEET_KINDS } from "./layout/stack.ts";
import { COMPANION_ACTION_IDS } from "./consent/acts.ts";
import { parsePipeline, sliceEntries } from "./panels/pipelineRead.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const core = (locale: string) => JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")).one.core;
const one = (locale: string) => JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")).one;
const TOOL_ACTS = ["letterApprove", "letterSend", "interviewBook", "interviewLink"] as const;

test("every say key, chip, change key and panel has words in all four locales", () => {
  for (const locale of ["en", "cs", "de", "fr"]) {
    const c = core(locale);
    for (const k of SAY_KEYS) assert.equal(typeof c.say[k], "string", `${locale} say.${k}`);
    for (const k of CHIP_IDS) assert.equal(typeof c.chips[k], "string", `${locale} chips.${k}`);
    for (const k of CHANGE_KEYS) assert.equal(typeof c.change[k], "string", `${locale} change.${k}`);
    for (const k of PANEL_KINDS) assert.equal(typeof c.panels[k].title, "string", `${locale} panels.${k}.title`);
    for (const k of COMPANION_ACTION_IDS) assert.equal(typeof c.consent.companion.title[k], "string", `${locale} companion.${k}`);
  }
});

test("the companion ids /one restates are still the real catalog's ids", () => {
  const src = readFileSync(path.join(ROOT, "app", "_lib", "companion-actions.ts"), "utf8");
  const real = [...src.matchAll(/^\s{4}id: "([a-z_]+)",$/gm)].map((m) => m[1]).sort();
  assert.deepEqual([...COMPANION_ACTION_IDS].sort(), real);
});

// Round 5: Sheets is the one layout — no variant vocabulary is left to drift. The layouts'
// catalog subtrees went with their folders, and nothing names a `?v=` direction any more.
test("one layout: only the sheets and core subtrees remain, no switcher words", () => {
  for (const locale of ["en", "cs", "de", "fr"]) {
    assert.deepEqual(Object.keys(one(locale)).sort(), ["core", "sheets"], `${locale} one.*`);
    assert.equal(one(locale).core.meta.variants, undefined, `${locale} meta.variants`);
    assert.equal(one(locale).core.meta.layout, undefined, `${locale} meta.layout`);
  }
  const types = readFileSync(path.join(ROOT, "app", "features", "one", "types.ts"), "utf8");
  assert.doesNotMatch(types, /VARIANT_IDS|variantOf/);
});

test("every tool act and sheet has its words in all four locales; no preview words are left", () => {
  for (const locale of ["en", "cs", "de", "fr"]) {
    const c = core(locale);
    assert.equal(c.consent.preview, undefined, `${locale} consent.preview`);
    assert.equal(c.consent.previewActs, undefined, `${locale} consent.previewActs`);
    assert.equal(c.sample, undefined, `${locale} sample (dev-only sample letters are gone)`);
    for (const k of TOOL_ACTS) {
      for (const f of ["title", "press", "details"]) assert.equal(typeof c.consent.acts[k][f], "string", `${locale} acts.${k}.${f}`);
    }
    for (const d of ["sent", "queued", "failed"]) {
      assert.equal(typeof c.consent.acts.letterSend[d], "string", `${locale} letterSend.${d}`);
      assert.equal(typeof c.consent.acts.interviewLink[d], "string", `${locale} interviewLink.${d}`);
    }
    for (const k of SHEET_KINDS) assert.equal(typeof one(locale).sheets.sheet[k], "string", `${locale} sheets.sheet.${k}`);
    assert.equal(typeof c.header.stats.letters.label, "string");
  }
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
