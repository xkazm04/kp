// The Outbox "Type" column renders a message KIND, and kinds are an open string
// on the wire (`OutboxItem.kind: string | null`) whose authoritative vocabulary is
// KNOWN_COMM_KINDS — the same array comms-envelope.test.ts already pins by set
// equality against every dispatcher.
//
// WHY THIS GUARD EXISTS: the round-22 localization pass shipped a catalog of FOUR
// kinds (invite / acknowledgement / outreach / rejection) authored from a guess
// rather than from that list. Nine of the thirteen real kinds had no entry, so
// `kindLabel`'s raw-value fallback rendered de-underscored English — "offer
// reminder", "interview confirmation", "schedule invite" — inside an otherwise
// German or Czech UI, on 23 of the 40 rows in a real workspace. The fallback was
// working as designed; the catalog was simply incomplete, and nothing failed.
// A missing key is invisible to `npm run i18n:check` (which compares locales to
// each other, not to the domain vocabulary) and invisible to typecheck (the lookup
// is a string index with a `.has()` guard). Only a live look caught it, so:
//
// Runner: Node's built-in test runner with type stripping — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { KNOWN_COMM_KINDS } from "@/app/_lib/comms-envelope.ts";

// app/features/tools/devcases/ -> repo root is four levels up (the Jul-28 restructure
// added the `tools/` area segment; a `..` too few silently resolved to app/features).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const LOCALES = ["en", "cs", "de", "fr"] as const;

function outboxKinds(locale: string): Record<string, string> {
  const raw = readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8");
  const catalog = JSON.parse(raw) as { devcase?: { outboxKind?: Record<string, string> } };
  return catalog.devcase?.outboxKind ?? {};
}

test("every locale's outboxKind catalog covers exactly KNOWN_COMM_KINDS", () => {
  // Widened to string[]: KNOWN_COMM_KINDS is a literal-union tuple, and we compare it
  // against catalog keys, which are plain strings.
  const expected: string[] = [...KNOWN_COMM_KINDS].sort();
  for (const locale of LOCALES) {
    const actual = Object.keys(outboxKinds(locale)).sort();
    const missing = expected.filter((k) => !actual.includes(k));
    const extra = actual.filter((k) => !expected.includes(k));
    assert.deepEqual(
      missing,
      [],
      `messages/${locale}.json devcase.outboxKind is missing ${missing.join(", ")} — the Outbox ` +
        `Type column will fall back to the raw English code for those rows. Add them to ALL four catalogs.`
    );
    // An extra key is dead weight that also signals the vocabulary was guessed:
    // the round-22 catalog carried "invite", which no dispatcher has ever emitted
    // (the real kind is "schedule_invite").
    assert.deepEqual(
      extra,
      [],
      `messages/${locale}.json devcase.outboxKind has ${extra.join(", ")}, which no dispatcher emits.`
    );
  }
});

test("no locale leaves an outboxKind label empty or untranslated-by-omission", () => {
  for (const locale of LOCALES) {
    for (const [kind, label] of Object.entries(outboxKinds(locale))) {
      assert.ok(label.trim().length > 0, `messages/${locale}.json devcase.outboxKind.${kind} is empty`);
    }
  }
});
