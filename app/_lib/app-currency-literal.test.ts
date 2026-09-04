// APP_CURRENCY is the app's single denomination seam (format.ts), and a bare "CZK"
// written somewhere else is a figure wearing a label the code did not price it in.
// The Python side has removed this exact stranded literal three times —
// market_salary_cli's REGION/currency prompt, salary_band's ceiling and step,
// automation's default bands — each time because the literal survived a re-homing
// that moved everything around it. This is the TS half of that rule, as a ratchet:
// the literal is banned repo-wide EXCEPT at the sites declared below, each with the
// reason it is genuinely a CZK figure rather than an un-re-homed default.
//
// The bar for adding an entry here: the value is denominated in Czech koruna as a
// FACT about that value (a price list quoted in CZK, a corpus that only holds CZK
// rows), not as the app's default market. If it is the app's market, it is
// APP_CURRENCY.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_CURRENCY } from "./format.ts";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Path (POSIX, relative to app/) -> why that file's "CZK" is a fact, not a default.
const ALLOWED: Record<string, string> = {
  "_lib/format.ts": "the definition of APP_CURRENCY itself",
  "_lib/db/salary-benchmark.ts":
    "the org-benchmark corpus is a CZK-only reference set (Česká spořitelna); the type says so and multi-currency is a later tier",
  "features/settings/billing/BillingPlanCatalog.tsx":
    "Polar pack prices are quoted in CZK as a price list (catalog.packs.*.priceCzk), not a salary band",
  "features/settings/billing/BillingPlanPrice.tsx":
    "the same CZK-quoted plan price list (price.czk)",
};

// `currency: "CZK"`, `currency="CZK"` and `?? "CZK"` — the three shapes a stranded
// default actually takes. A "CZK" inside a comment or a message string is prose
// about the currency, not a value labelled with it, so the patterns require the
// literal to sit in a currency POSITION.
const PATTERNS: RegExp[] = [
  /\bcurrency\s*:\s*"CZK"/,
  /\bcurrency\s*=\s*"CZK"/,
  /\?\?\s*"CZK"/,
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    // Fixtures legitimately hand-write a CZK payload to drive the code under test.
    if (/\.test\.tsx?$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

test("no stranded CZK currency literal outside the declared sites", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(APP_DIR)) {
    const rel = path.relative(APP_DIR, file).split(path.sep).join("/");
    if (rel in ALLOWED) continue;
    const text = readFileSync(file, "utf8");
    text.split(/\r?\n/).forEach((line, i) => {
      // A comment ABOUT the literal (several files document the `?? "CZK"` default
      // they removed) is prose, not a value wearing a label.
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      if (PATTERNS.some((p) => p.test(line))) offenders.push(`${rel}:${i + 1}  ${trimmed}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `A hardcoded "CZK" labels a figure the code did not price. Use APP_CURRENCY (app/_lib/format.ts), ` +
      `or — only if the value really is CZK by nature — add the file to ALLOWED with the reason.\n${offenders.join("\n")}`,
  );
});

test("the allowlist stays honest: every declared site still carries the literal", () => {
  // A stale exemption is how a ban quietly stops meaning anything: the entry
  // outlives the literal, and the next stranded default lands in a file that is
  // already waved through.
  for (const [rel, reason] of Object.entries(ALLOWED)) {
    const text = readFileSync(path.join(APP_DIR, rel), "utf8");
    assert.ok(
      PATTERNS.some((p) => p.test(text)) || text.includes(`= "${APP_CURRENCY}"`),
      `${rel} no longer contains a CZK literal — drop its ALLOWED entry (${reason})`,
    );
  }
});

test("the simulation offer draft is denominated through APP_CURRENCY", () => {
  // The sim route is the site this ratchet was written for: it hardcoded the
  // currency the market seam exists to own, on a letter the sim actually mails.
  const route = readFileSync(path.join(APP_DIR, "api/sim/offer-draft/route.ts"), "utf8");
  assert.match(route, /currency:\s*APP_CURRENCY/, "the sim offer draft must label the band with APP_CURRENCY");
});
