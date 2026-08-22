// The guard `jd-template-tokens.ts` claims it has and did not: that every
// TEMPLATE_LOCALIZED_TOKEN resolves to real copy, in EVERY locale, before it is
// substituted into a published job description.
//
// Why a test and not the type system: `namespaceTranslator` loads catalogs
// dynamically, so next-intl's compile-time key checking is off (see the header of
// app/_lib/catalog-translator.ts — "the catalogs are pinned instead by tests that
// render every key"). A missing message is therefore NOT loud. next-intl's
// MISSING_MESSAGE fallback is the KEY PATH itself, a perfectly non-empty string, so
// `jdTemplateTokens` would hand renderTemplate `"library.templates.token.heading_about"`
// and that raw key would ship as a section heading on a live, shareable posting —
// the same failure mode as an unresolved `{{heading_about}}`, just harder to spot.
// (renderTemplate.test.ts binds `jdTemplateTokens("en")` and says the keys are
// "proven to exist", but never asserts it, and only ever touches "en".)
//
// Runner: Node's built-in test runner with type stripping — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCALES } from "@/i18n/locales";
import { TEMPLATE_LOCALIZED_TOKENS } from "@/app/features/shared/renderTemplate";
import { jdTemplateTokens } from "./jd-template-tokens.ts";

const KEY_PATH_RE = /library\.templates\.token/;

for (const locale of LOCALES) {
  test(`every JD template token resolves to real ${locale} copy (not a raw key path)`, async () => {
    const tokens = await jdTemplateTokens(locale);
    for (const token of TEMPLATE_LOCALIZED_TOKENS) {
      const value = tokens[token];
      assert.equal(typeof value, "string", `${locale}/${token} must resolve to a string`);
      assert.ok(value.trim().length > 0, `${locale}/${token} must not be blank`);
      assert.doesNotMatch(
        value,
        KEY_PATH_RE,
        `${locale}/${token} resolved to next-intl's missing-message key path — the catalog entry is absent, and this string would render onto a published JD`,
      );
      // A token's copy is substituted verbatim; a nested placeholder would survive
      // into the posting because renderTemplate does a single substitution pass.
      assert.doesNotMatch(value, /\{\{|\}\}/, `${locale}/${token} must not itself contain a {{placeholder}}`);
    }
  });
}

test("an absent or unsupported output language falls back to the default locale's copy", async () => {
  // The JD's `lang` reaches here straight off a task's params (jd-build-run), so it
  // can be undefined (a legacy build) or something isLocale rejects. Either must
  // resolve real copy rather than a key path.
  const fallback = await jdTemplateTokens(undefined);
  const english = await jdTemplateTokens("en");
  assert.deepEqual(fallback, english);
  assert.deepEqual(await jdTemplateTokens("de-AT"), english);
  assert.deepEqual(await jdTemplateTokens(null), english);
});

test("the token map carries exactly the tokens renderTemplate substitutes", () => {
  // Built from the tuple rather than a literal, so this pins the shape contract:
  // an extra key here would be dead copy, a missing one an unresolved {{token}}.
  return jdTemplateTokens("cs").then((tokens) => {
    assert.deepEqual(Object.keys(tokens).sort(), [...TEMPLATE_LOCALIZED_TOKENS].sort());
  });
});
