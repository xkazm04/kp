// The planted-canary verdict vocabulary is FOUR-WAY and the four are not
// interchangeable: `addressed` (the flaw is gone), `flagged` (left in place but
// called out), `propagated` (THE PLANTED FLAW SURVIVED), `unverifiable` (not
// mechanically gradable — never scored, never shown as a pass). Collapsing them to
// a pass/fail binary would erase the two findings a reviewer most needs.
//
// WHY THIS GUARD EXISTS: `npm run i18n:check` compares the locale catalogs to EACH
// OTHER, never to the domain vocabulary — deleting a status from all four catalogs
// leaves it green. Typecheck cannot catch it either: the lookup is `t(\`canary.${s}\`)`,
// a template-string key. So a missing status would surface at runtime as a raw
// next-intl fallback in the middle of an otherwise translated panel, on exactly the
// rows that carry the strongest evidence. This test pins all four catalogs to
// CANARY_STATUSES by SET EQUALITY, in both directions.
//
// Runner: Node's built-in test runner with type stripping — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CANARY_STATUSES } from "./DevTypes.ts";

// app/features/tools/devcases/ -> repo root is four levels up.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const LOCALES = ["en", "cs", "de", "fr"] as const;

function canaryCatalog(locale: string): Record<string, string> {
  const raw = readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8");
  const catalog = JSON.parse(raw) as { devcase?: { checks?: { canary?: Record<string, string> } } };
  return catalog.devcase?.checks?.canary ?? {};
}

test("every locale's canary catalog covers exactly CANARY_STATUSES", () => {
  // Widened to string[]: CANARY_STATUSES is a literal-union tuple and we compare it
  // against catalog keys, which are plain strings.
  const expected: string[] = [...CANARY_STATUSES].sort();
  for (const locale of LOCALES) {
    const actual = Object.keys(canaryCatalog(locale)).sort();
    const missing = expected.filter((k) => !actual.includes(k));
    const extra = actual.filter((k) => !expected.includes(k));
    assert.deepEqual(
      missing,
      [],
      `messages/${locale}.json devcase.checks.canary is missing ${missing.join(", ")} — those verdicts would ` +
        `render as a raw key in the evidence panel. Add them to ALL four catalogs.`
    );
    assert.deepEqual(
      extra,
      [],
      `messages/${locale}.json devcase.checks.canary has ${extra.join(", ")}, which artifact_checks.canary_outcomes ` +
        `never emits — the vocabulary was guessed rather than read off the producer.`
    );
  }
});

test("no locale leaves a canary verdict label empty", () => {
  for (const locale of LOCALES) {
    for (const [status, label] of Object.entries(canaryCatalog(locale))) {
      assert.ok(label.trim().length > 0, `messages/${locale}.json devcase.checks.canary.${status} is empty`);
    }
  }
});

// The set above is only trustworthy if it still matches the PRODUCER. artifact_checks.py
// is the single place the four verdicts are minted; if a fifth is ever added there, this
// fails and points at the catalogs rather than letting the new verdict render as a raw key.
test("CANARY_STATUSES matches the statuses artifact_checks.py actually emits", () => {
  const src = readFileSync(path.join(ROOT, "pipeline", "jobfit", "devcase", "artifact_checks.py"), "utf8");
  // Every `status = "<value>"` assignment inside canary_outcomes.
  const emitted = new Set([...src.matchAll(/^\s*status = "([a-z_]+)"/gm)].map((m) => m[1]));
  assert.deepEqual(
    [...emitted].sort(),
    [...CANARY_STATUSES].sort(),
    "artifact_checks.py emits a different canary vocabulary than DevTypes.CANARY_STATUSES declares — " +
      "update the type AND all four i18n catalogs."
  );
});
