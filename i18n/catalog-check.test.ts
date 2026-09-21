import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkCatalogs, countStrings, stringUnits } from "../scripts/i18n/catalog-check.mjs";

// Negative controls for the catalog half of `npm run i18n:check`
// (scripts/i18n/catalog-check.mjs). They live here rather than beside the script
// because `npm run test:unit` already globs `i18n/**/*.test.ts` — the same reason
// app/_components/primitive-copy-defaults.test.ts sits where it does.
//
// The shape these guard against: the gate once stored an array as one leaf value
// and every content check skipped non-strings, so an em dash inside a list was
// never seen. Each planted defect below sits in a container shape the real
// catalogs use, and the matching clean fixture proves the finding comes from the
// defect and not from the shape.

const clean = () => ({
  landing: {
    title: "Hire on evidence",
    voice: { transcript: ["You shipped an app. What broke first?", "State management."] },
    pricing: { tiers: [{ name: "Team", features: ["Five seats", "{count} interviews a month"] }] }
  }
});

const run = (en: unknown, cs: unknown = en) =>
  checkCatalogs(
    [
      { locale: "en", data: en },
      { locale: "cs", data: cs }
    ],
    "en"
  );

test("the clean fixture passes, and every string in it is a checked unit", () => {
  const result = run(clean());
  assert.deepEqual(result.problems, []);
  assert.equal(result.coverage.defaultStrings, countStrings(clean()));
  assert.equal(result.coverage.defaultStrings, 6);
  // Both transcript lines, the tier name (an object inside a list) and both features.
  assert.equal(result.coverage.listStrings, 5);
  assert.ok(result.baseKeys.includes("landing.voice.transcript[0]"));
  assert.ok(result.baseKeys.includes("landing.pricing.tiers[0].features[1]"));
});

test("an em dash inside an array fails, addressed by index", () => {
  const en = clean();
  en.landing.voice.transcript[0] = "You shipped an app — what broke first?";
  const found = run(en, clean()).problems;
  assert.ok(
    found.some((p) => p.startsWith('en: "landing.voice.transcript[0]"') && p.includes("em dash")),
    found.join("\n")
  );
});

test("an em dash inside an object inside an array fails, addressed by index and key", () => {
  const cs = clean();
  cs.landing.pricing.tiers[0].name = "Tým — malý";
  const found = run(clean(), cs).problems;
  assert.ok(
    found.some((p) => p.startsWith('cs: "landing.pricing.tiers[0].name"') && p.includes("em dash")),
    found.join("\n")
  );
});

test("a prose en dash inside a translated list fails", () => {
  const cs = clean();
  cs.landing.voice.transcript[0] = "Nasadili jste aplikaci – co se rozbilo?";
  assert.ok(run(clean(), cs).problems.some((p) => p.startsWith('cs: "landing.voice.transcript[0]"') && p.includes("en dash")));
});

test("placeholder parity reaches strings inside lists", () => {
  const cs = clean();
  cs.landing.pricing.tiers[0].features[1] = "{pocet} pohovorů měsíčně";
  const found = run(clean(), cs).problems;
  assert.ok(found.includes('cs: "landing.pricing.tiers[0].features[1]" — missing placeholder {count}'), found.join("\n"));
});

test("a translated list with a different length is reported once, as a list", () => {
  const cs = clean();
  cs.landing.voice.transcript.push("Navíc.");
  const found = run(clean(), cs).problems;
  assert.deepEqual(found, ['cs: "landing.voice.transcript" — list has 3 item(s), en has 2; translated lists must match item for item']);
});

test("a walker that extracts fewer strings than the catalog holds fails the run", () => {
  // Two keys that collide on one address: `a.b` as a nested path and as a literal
  // key. The walker keeps one; the independent count sees both.
  const en = { a: { b: "One" }, "a.b": "Two" };
  assert.equal(stringUnits(en).units.size, 1);
  assert.equal(countStrings(en), 2);
  assert.ok(run(en).problems.some((p) => p.startsWith("en: the walker extracted 1 string(s) but the catalog holds 2")));
});

test("an empty catalog is a failure, not a clean result", () => {
  assert.ok(run({}).problems.some((p) => p.includes("zero strings")));
});

test("the shipped catalogs: every string is a unit, and the list strings are among them", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "messages");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    const { units, arrays } = stringUnits(data);
    assert.equal(units.size, countStrings(data), file);
    assert.ok(arrays.size > 0, `${file} has no lists; this fixture no longer exercises the array path`);
  }
});
