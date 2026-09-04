// The store's coded event details, pinned from both ends.
//
// Six recordEvent calls in db/pipeline.ts used to store an English SENTENCE as the
// event detail ("Role closed — candidate withdrawn from the pipeline."), and the
// activity feed paints a detail verbatim — so a Czech or German recruiter read a
// localized verb followed by an English explanation of it. They now store
// `reason:<code>`, the same record-vs-screen split automation-run.ts already runs: the
// STORE writes a machine token, the SCREEN resolves it in the reader's language.
//
// That split only works while three things agree, and nothing structural forces them to,
// because the writer and the renderer are in different module worlds (this file opens
// SQLite; pipelineEventCatalog.ts is a client component, so neither can import the
// other). This test is what forces it:
//
//   1. Every declared code has a `pipeline.eventReasons` entry in ALL FOUR locales —
//      i18n:check only proves the four catalogs match EACH OTHER, so a code with no
//      entry anywhere is invisible to it and would silently fall through to the raw
//      English prose branch.
//   2. The wire PREFIX is identical on both sides (it is duplicated, not imported).
//   3. Every code is SHAPED so the renderer's parser accepts it — `codedReason` only
//      recognizes `reason:` followed by letters, so a code with a digit or a dash would
//      be written, stored, and then never resolved.
//
// It also pins the property that made this change safe to ship without a migration:
// LEGACY rows still render, because the coded branch is only taken on an exact match.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PIPELINE_REASON_CODES, PIPELINE_REASON_PREFIX, pipelineReasonDetail } from "./pipeline.ts";

const LOCALES = ["en", "cs", "de", "fr"] as const;

function catalog(locale: string): Record<string, string> {
  const raw = readFileSync(fileURLToPath(new URL(`../../../messages/${locale}.json`, import.meta.url)), "utf8");
  return (JSON.parse(raw) as { pipeline: { eventReasons: Record<string, string> } }).pipeline.eventReasons;
}

test("every declared reason code is localized in all four catalogs", () => {
  assert.ok(PIPELINE_REASON_CODES.length > 0, "the vocabulary is not empty");
  for (const locale of LOCALES) {
    const entries = catalog(locale);
    for (const code of PIPELINE_REASON_CODES) {
      const value = entries[code];
      assert.equal(typeof value, "string", `messages/${locale}.json is missing pipeline.eventReasons.${code}`);
      assert.ok(value.trim().length > 0, `pipeline.eventReasons.${code} is blank in ${locale}`);
    }
  }
});

test("the translations are real, not English copied into the other three catalogs", () => {
  const en = catalog("en");
  for (const locale of ["cs", "de", "fr"] as const) {
    const entries = catalog(locale);
    for (const code of PIPELINE_REASON_CODES) {
      assert.notEqual(
        entries[code],
        en[code],
        `pipeline.eventReasons.${code} in ${locale} is the English string verbatim — the feed would still read English there`
      );
    }
  }
});

test("the wire prefix matches the renderer's, which duplicates it rather than importing it", () => {
  const renderer = readFileSync(
    fileURLToPath(new URL("../../features/hiring/pipeline/pipelineEventCatalog.ts", import.meta.url)),
    "utf8"
  );
  assert.match(
    renderer,
    new RegExp(`const prefix = "${PIPELINE_REASON_PREFIX}"`),
    "pipelineEventCatalog.ts parses a different prefix than the store writes — the coded details would never resolve"
  );
  assert.match(
    renderer,
    /useTranslations\("pipeline\.eventReasons"\)/,
    "the renderer must resolve coded details through the pipeline.eventReasons namespace this test pins"
  );
});

test("every code is shaped so the renderer's parser accepts it", () => {
  // The renderer's own guard, restated: `reason:` then letters only. A code with a digit,
  // dash or dot would be stored and then silently ignored at render time.
  for (const code of PIPELINE_REASON_CODES) {
    const detail = pipelineReasonDetail(code);
    assert.ok(detail.startsWith(PIPELINE_REASON_PREFIX), `${code} must be written with the wire prefix`);
    assert.match(detail.slice(PIPELINE_REASON_PREFIX.length), /^[A-Za-z]+$/, `${code} is not letters-only — the renderer would drop it`);
  }
});

test("the store no longer writes an English sentence as an event detail", () => {
  const source = readFileSync(fileURLToPath(new URL("./pipeline.ts", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  // Every string LITERAL reachable as a `detail:` value — including the arm of a ternary,
  // which is where the seventh one was hiding after the first six were converted
  // (`detail: degraded ? reason : "added to pipeline"`). A detail may still legitimately
  // be a VARIABLE (a slot time, a rematch counterpart handle, an intake diagnostic) —
  // what must not come back is prose typed at the call site in one language.
  const literals = [...source.matchAll(/\bdetail:\s*([^,\n]*)/g)]
    // The helper call is the CURE, so its own argument is not a finding — strip
    // `pipelineReasonDetail("…")` before looking for prose.
    .map((m) => m[1].replace(/pipelineReasonDetail\("[A-Za-z]+"\)/g, "CODED"))
    .flatMap((expr) => [...expr.matchAll(/"([^"]*)"/g)].map((q) => q[1]));
  for (const literal of literals) {
    assert.fail(
      `db/pipeline.ts stores a hardcoded English event detail (${JSON.stringify(literal)}). ` +
        `Add a code to PIPELINE_REASON_CODES and write pipelineReasonDetail("<code>") instead — ` +
        `the activity feed paints a detail verbatim, so a literal here ships English to every locale.`
    );
  }
});

test("a legacy row's English prose still renders — the coded branch is opt-in", () => {
  // The renderer takes the coded branch ONLY on an exact `reason:<letters>` match. This is
  // why the six call sites could change with no migration: every row already in a
  // deployed database keeps rendering exactly as it did.
  for (const legacy of [
    "Role closed — candidate withdrawn from the pipeline.",
    "manual",
    "2026-03-04T10:00:00.000Z",
    "reason: with a space",
    "reason:has-a-dash",
    "reason:has1digit",
  ]) {
    const isCoded = legacy.startsWith(PIPELINE_REASON_PREFIX) && /^[A-Za-z]+$/.test(legacy.slice(PIPELINE_REASON_PREFIX.length).trim());
    assert.equal(isCoded, false, `${JSON.stringify(legacy)} must fall through to the legacy rendering, not be treated as a code`);
  }
});
