// Pins the `table.*` catalog — the copy for the shared pager and column-filter
// primitives — against the CALL SHAPES the components actually use, in every locale.
//
// These strings used to live under `channels.*` and were covered by
// channels-i18n.test.ts. They moved out with the primitives (TablePager /
// ColumnFilter now serve the Channels ledger, the Archetypes roster and the
// Assignments outbox alike), and the coverage moved with them: a message that drops
// a placeholder renders happily under ICU and leaves the reader with a pager that
// says "–  of" or a filter menu headed "All — ". `tsc` cannot see any of that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { LOCALES, type Locale } from "@/i18n/locales";

// (key, values) exactly as TablePager.tsx / ColumnFilter.tsx / FilterMenu.tsx /
// ColumnHead.tsx call them. Keep in lockstep with those four files.
const PLAIN: [string, Record<string, unknown>][] = [
  ["pager.label", {}],
  ["pager.range", { from: 21, to: 40, total: 47 }],
  ["pager.page", { page: 2, pages: 3 }],
  ["pager.prev", {}],
  ["pager.next", {}],
  ["filters.search", {}],
  ["filters.searchOptions", {}],
  ["filters.noMatches", {}],
  // The column TITLE is interpolated as given (never lower-cased) — a localized
  // header may be a capitalized German noun.
  ["filters.searchColumn", { column: "Rolle" }],
  ["filters.allOf", { column: "Rolle" }],
  ["filters.select", {}],
  // The two column-scoped strings that are ACCESSIBLE NAMES rather than visible
  // copy — ColumnFilter's icon trigger (trigger="icon") and ColumnHead's sort
  // button carry no text label, so a message that drops {column} leaves a screen
  // reader with a row of identical "Filter"/"Sort by" buttons and no way to tell
  // which column each one belongs to. Nothing on screen would look wrong.
  ["filters.filterColumn", { column: "Rolle" }],
  ["sortBy", { column: "Rolle" }],
];

for (const locale of LOCALES) {
  test(`table catalog (${locale}): every message renders with the values the UI passes`, () => {
    const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8"));
    const t = createTranslator({ locale, messages, namespace: "table" }) as unknown as (
      key: string,
      values?: Record<string, unknown>
    ) => string;
    for (const [key, values] of PLAIN) {
      const out = t(key, values);
      assert.ok(out.length > 0, `${locale} table.${key} is empty`);
      // next-intl echoes the full key path when a message is missing.
      assert.ok(!out.includes("table."), `${locale} table.${key} is missing (next-intl echoed the key): ${out}`);
      // A dropped placeholder is the failure mode ICU will not complain about.
      assert.ok(!/\{\w+\}/.test(out), `${locale} table.${key} left an unfilled placeholder: ${out}`);
    }
  });

  test(`table catalog (${locale}): the pager range names all three numbers`, () => {
    const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8"));
    const t = createTranslator({ locale, messages, namespace: "table" }) as unknown as (
      key: string,
      values?: Record<string, unknown>
    ) => string;
    // "21–40 of 47" answers "how much is left" without arithmetic. A translation
    // that drops `total` (or collapses from/to) silently removes that answer.
    const out = t("pager.range", { from: 21, to: 40, total: 47 });
    for (const n of ["21", "40", "47"]) {
      assert.ok(out.includes(n), `${locale} table.pager.range must show ${n}: ${out}`);
    }
  });

  test(`table catalog (${locale}): the icon controls' accessible names still name the column`, () => {
    const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8"));
    const t = createTranslator({ locale, messages, namespace: "table" }) as unknown as (
      key: string,
      values?: Record<string, unknown>
    ) => string;
    // A translation that drops {column} passes ICU and reads fine on screen (the
    // controls are icon-only), but every column's filter and sort button then
    // announces the same name.
    for (const key of ["filters.filterColumn", "sortBy"]) {
      const out = t(key, { column: "Rolle" });
      assert.ok(out.includes("Rolle"), `${locale} table.${key} must name the column: ${out}`);
    }
  });
}
