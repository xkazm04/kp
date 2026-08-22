// Pins the ordering rule behind the History tab's filter dropdowns.
//
// The dropdowns render LOCALIZED labels (`enums.family.*`) but were emitted in
// `distinct()`'s canonical-slug order, and the obvious "fix" — a plain `.sort()`
// / locale-less `localeCompare` on the labels — trades one wrong order for the
// classic Czech collation failure (Č/Ř/Š/Ž after Z). Both wrong orders are
// reproduced here as the non-vacuity proof: `sortOptionsByLabel` must DIVERGE
// from each of them on the real catalog.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { distinct, sortOptionsByLabel } from "./HistoryTypes.ts";

// The real `enums.family` labels from messages/cs.json, keyed by the canonical
// slug the analyses table stores.
const CS_FAMILY: Record<string, string> = {
  creative_design: "Kreativa / design",
  customer_support: "Zákaznická podpora",
  data_ai: "Data / AI",
  operations_logistics: "Provoz / logistika",
  product_project: "Produkt / projekt",
  legal_compliance: "Právo / compliance",
  skilled_trades: "Řemesla / technické profese",
  frontline_service: "Služby v první linii",
  software_engineering: "Software",
};

const options = (slugs: string[]) => slugs.map((value) => ({ value, label: CS_FAMILY[value] }));
const labels = (opts: { label: string }[]) => opts.map((o) => o.label);

// ── The slug order the dropdown used to render ────────────────────────────────
test("slug order is not an order at all in cs — the collated order differs", () => {
  const slugOrder = distinct(Object.keys(CS_FAMILY));
  const before = labels(options(slugOrder));
  const after = labels(sortOptionsByLabel(options(slugOrder), "cs"));

  // Pre-fix: "Zákaznická podpora" (Z) sat second, right after "Kreativa".
  assert.equal(before[1], "Zákaznická podpora", "pre-fix: a Z label two rows from the top");
  assert.notDeepEqual(after, before, "the collated order must differ from the slug order");
  assert.equal(after[0], "Data / AI");
  assert.equal(after.at(-1), "Zákaznická podpora", "Z belongs last in cs, not second");
});

// ── The regression this guards: Č/Ř/Š/Ž must NOT file after Z ─────────────────
test("cs diacritics collate in place, not past Z (Ř after Provoz, before Služby)", () => {
  const slugs = ["customer_support", "skilled_trades", "operations_logistics", "frontline_service"];
  const sorted = labels(sortOptionsByLabel(options(slugs), "cs"));
  assert.deepEqual(sorted, [
    "Provoz / logistika",
    "Řemesla / technické profese",
    "Služby v první linii",
    "Zákaznická podpora",
  ]);

  // Non-vacuity: the locale-less sort — the one a reviewer would reach for —
  // compares UTF-16 code units, so Ř (U+0158) files AFTER Z (U+005A) and the
  // Czech recruiter scrolls past their own alphabet to find it.
  const naive = labels(options(slugs)).sort();
  assert.equal(naive.at(-1), "Řemesla / technické profese", "pre-fix: Ř dumped past Z");
  assert.notDeepEqual(naive, sorted);
});

// ── "Právo" vs "Produkt/Provoz": á must not sort past o ───────────────────────
test("cs accented vowels collate with their base letter (Právo before Produkt)", () => {
  const slugs = ["product_project", "legal_compliance", "operations_logistics"];
  const sorted = labels(sortOptionsByLabel(options(slugs), "cs"));
  assert.deepEqual(sorted, ["Právo / compliance", "Produkt / projekt", "Provoz / logistika"]);

  const naive = labels(options(slugs)).sort();
  assert.equal(naive.at(-1), "Právo / compliance", "pre-fix: á (U+00E1) sorted past o");
});

// ── en is unaffected (the order it already had is the order it keeps) ─────────
test("an already-alphabetical label set is left in place", () => {
  const en = [
    { value: "data_ai", label: "Data / AI" },
    { value: "finance_accounting", label: "Finance / accounting" },
    { value: "legal_compliance", label: "Legal / compliance" },
  ];
  assert.deepEqual(labels(sortOptionsByLabel(en, "en")), labels(en));
});

// ── Purity: the caller's array (a useMemo result) must not be mutated ─────────
test("sortOptionsByLabel returns a new array and leaves the input untouched", () => {
  const input = options(["customer_support", "data_ai"]);
  const snapshot = labels(input);
  const sorted = sortOptionsByLabel(input, "cs");
  assert.notEqual(sorted, input, "must not sort the caller's array in place");
  assert.deepEqual(labels(input), snapshot);
  assert.deepEqual(labels(sorted), ["Data / AI", "Zákaznická podpora"]);
});

// ── An unknown locale tag falls back rather than throwing ─────────────────────
test("an unsupported locale tag does not throw", () => {
  assert.doesNotThrow(() => sortOptionsByLabel(options(["data_ai", "customer_support"]), "zz"));
});
