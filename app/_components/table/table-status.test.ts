// The announce contract for the shared table kit.
//
// Sorting reorders a table and filtering shrinks it; both are invisible to a
// screen reader unless something says so. Before `TableStatus` the ONLY
// `aria-live` anywhere under `app/_components/table/` was the pager's range
// line — so a reader could operate the roster's sort, hear "Sort by Candidate",
// and be given no evidence the table had changed at all.
//
// Two halves are pinned here, both at the SOURCE level (there is no JSX runner
// in this suite — `filter-a11y.test.ts` next door pins its roles the same way):
//
//   1. the region itself is a polite, atomic, sr-only status; and
//   2. every surface that owns a sort or a filter today actually renders it —
//      a shared region nobody mounts announces nothing, and that regression is
//      invisible in review because the table still looks right.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createTranslator } from "next-intl";
import { LOCALES } from "@/i18n/locales";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..", "..");
const read = (rel: string) => readFileSync(path.join(APP, rel), "utf8");

const source = read("_components/table/TableStatus.tsx");

/** The surfaces that own a sort or a filter today. Adding one adds a row here. */
const WIRED = [
  "features/tools/profile/ProfileRoster.tsx",
  "features/insights/analytics/sections/DecisionLogTable.tsx",
  "features/insights/activity/ActivityTab.tsx",
  "features/shell/tasks/TasksRunsPanel.tsx",
];

test("the status region is polite, atomic and invisible", () => {
  assert.match(source, /role="status"/, "a status region, not an alert — a reordering is not an interruption");
  assert.match(source, /aria-live="polite"/);
  // Without aria-atomic a reader can be handed the changed clause alone —
  // "descending", with no column named.
  assert.match(source, /aria-atomic="true"/);
  assert.match(source, /className="sr-only"/, "the sentence duplicates what sighted readers already see");
});

test("an unfiltered table says nothing about matching", () => {
  // "174 rows match" on a table nobody has filtered is noise on every render.
  assert.match(source, /if \(filtered && matched != null\)/);
});

test("every sortable or filterable surface mounts the region", () => {
  for (const rel of WIRED) {
    const src = read(rel);
    assert.match(src, /<TableStatus\b/, `${rel} owns a sort or filter but mounts no TableStatus`);
    assert.match(src, /from "@\/app\/_components\/table\/TableStatus"/, `${rel} must import the shared region`);
  }
});

for (const locale of LOCALES) {
  test(`table.status catalog (${locale}) renders with the values the region passes`, () => {
    const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8"));
    const t = createTranslator({ locale, messages, namespace: "table.status" }) as unknown as (
      key: string,
      values?: Record<string, unknown>
    ) => string;
    for (const key of ["sortedAsc", "sortedDesc"]) {
      const out = t(key, { column: "Rolle" });
      assert.ok(out.length > 0, `${locale} table.status.${key} is empty`);
      assert.ok(!out.includes("table.status."), `${locale} table.status.${key} is missing: ${out}`);
      // A translation that drops {column} passes ICU and announces the same
      // sentence for every column.
      assert.ok(out.includes("Rolle"), `${locale} table.status.${key} must name the column: ${out}`);
    }
    // …and the two directions must be DIFFERENT sentences, or the announcement
    // cannot tell a reader which way the flip went.
    assert.notEqual(t("sortedAsc", { column: "Rolle" }), t("sortedDesc", { column: "Rolle" }));
    // The plural must actually branch: a catalog that hardcodes one form reads
    // "1 rows match" in every locale that has a singular.
    const one = t("matched", { count: 1 });
    const many = t("matched", { count: 7 });
    assert.ok(one.includes("1"), `${locale} table.status.matched must show the count: ${one}`);
    assert.ok(many.includes("7"), `${locale} table.status.matched must show the count: ${many}`);
    assert.ok(!/\{\w+\}/.test(one + many), `${locale} table.status.matched left an unfilled placeholder`);
    assert.notEqual(one, many.replace("7", "1"), `${locale} table.status.matched does not branch on count`);
  });
}
