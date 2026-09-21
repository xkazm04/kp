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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  analysisProducer,
  distinct,
  historyRowMatchesQuery,
  historyShowingTotal,
  readAnalysesListPayload,
  sortOptionsByLabel,
} from "./HistoryTypes.ts";

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

const row = (slug: string): { slug: string; candidate_label: string; jd_slug: null; score: null; role_family: null; seniority: null; created_at: string } => ({
  slug,
  candidate_label: slug,
  jd_slug: null,
  score: null,
  role_family: null,
  seniority: null,
  created_at: "2026-01-01T00:00:00Z",
});

test("a truncated payload is a page, never a complete-list total", () => {
  const page = readAnalysesListPayload({
    analyses: [row("a"), row("b")],
    truncated: true,
    limit: 200,
  });
  assert.equal(page.truncated, true);
  assert.equal(page.limit, 200);
  assert.equal(page.analyses.length, 2);
  assert.equal(historyShowingTotal(page.analyses.length, page.truncated), null, "Showing-of has no population figure");
});

test("a complete payload keeps rows.length as the total", () => {
  const page = readAnalysesListPayload({
    analyses: [row("a")],
    truncated: false,
    limit: 200,
  });
  assert.equal(page.truncated, false);
  assert.equal(historyShowingTotal(page.analyses.length, page.truncated), 1);
});

test("truncated is a positive claim: missing or junk is not invented as true", () => {
  assert.equal(readAnalysesListPayload({ analyses: [row("a")] }).truncated, false);
  assert.equal(readAnalysesListPayload({ analyses: [row("a")], truncated: "yes" }).truncated, false);
  assert.equal(readAnalysesListPayload({ analyses: "nope" }).analyses.length, 0);
  assert.equal(readAnalysesListPayload(null).analyses.length, 0);
});

test("analysisProducer names llm, deterministic, and unknown; null is never llm", () => {
  assert.equal(analysisProducer("llm"), "llm");
  assert.equal(analysisProducer("deterministic"), "deterministic");
  assert.equal(analysisProducer(null), "unknown");
  assert.equal(analysisProducer(undefined), "unknown");
  assert.equal(analysisProducer(""), "unknown");
  assert.equal(analysisProducer("gemini"), "unknown");
});

test("HistoryTable paints the producer chip from analysisProducer, never a raw engine string", () => {
  const table = readFileSync(fileURLToPath(new URL("./HistoryTable.tsx", import.meta.url)), "utf8");
  assert.match(table, /analysisProducer\(engine\)/, "deterministic/null/llm go through the mapper");
  assert.match(table, /t\(`producer\.\$\{producer\}`\)/, "the chip label is the localized producer.* key");
  assert.match(table, /t\("colProducer"\)/, "the column is present");
  assert.doesNotMatch(table, /producer\.llm/, "null must not hard-code llm");
});

test("capek matches Čapek; exact slug still matches", () => {
  const named = { ...row("cv-capek"), candidate_label: "Čapek" };
  assert.equal(historyRowMatchesQuery(named, "capek"), true, "ASCII needle");
  assert.equal(historyRowMatchesQuery(named, "Čapek"), true, "exact diacritic needle");
  assert.equal(historyRowMatchesQuery(named, "CAPEK"), true, "case-folded needle");
  assert.equal(historyRowMatchesQuery(row("ada-lovelace"), "ada-lovelace"), true, "exact slug");
  assert.equal(historyRowMatchesQuery(named, "novak"), false);
});

test("HistoryTab search uses the folded matcher, not toLowerCase alone", () => {
  const tab = readFileSync(fileURLToPath(new URL("./HistoryTab.tsx", import.meta.url)), "utf8");
  assert.match(tab, /historyRowMatchesQuery/, "HistoryTab folds through HistoryTypes");
  assert.doesNotMatch(tab, /candidate_label\.toLowerCase\(\)/, "bare toLowerCase was the pre-fix needle");
});

test("History dates go through the shared formatter; toLocaleString is gone", () => {
  const table = readFileSync(fileURLToPath(new URL("./HistoryTable.tsx", import.meta.url)), "utf8");
  const page = readFileSync(fileURLToPath(new URL("../../../../history/[slug]/page.tsx", import.meta.url)), "utf8");
  assert.doesNotMatch(table, /toLocaleDateString|toLocaleString/);
  assert.doesNotMatch(page, /toLocaleDateString|toLocaleString/);
  assert.match(table, /useDateFormat/, "HistoryTable absolute fallback uses the client formatter");
  assert.match(page, /dateFormatter/, "the saved-report header uses the memoized server formatter");
});

test("History names a truncated page as a page and drops the complete-list claim", () => {
  const tab = readFileSync(fileURLToPath(new URL("./HistoryTab.tsx", import.meta.url)), "utf8");
  const bar = readFileSync(fileURLToPath(new URL("./HistoryFilterBar.tsx", import.meta.url)), "utf8");
  assert.match(tab, /readAnalysesListPayload/, "HistoryTab reads the route's honesty triple");
  assert.match(tab, /t\("truncated"/, "truncated true paints the newest-N warning");
  assert.match(tab, /truncated=\{truncated\}/, "the flag reaches the filter bar");
  assert.match(bar, /truncated\s*\?\s*t\("showingLoaded"/, "Showing-of uses the loaded-slice copy when truncated");
  assert.match(bar, /: t\("showing", \{ shown: filteredCount, total: totalCount \}\)/, "the complete-list copy is the else branch");
});
