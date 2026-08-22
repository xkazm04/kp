import { namespaceTranslator } from "./catalog-translator";
import { isLocale, DEFAULT_LOCALE } from "@/i18n/locales";
import { TEMPLATE_LOCALIZED_TOKENS, type TemplateTokens } from "@/app/features/shared/renderTemplate";

// F5 — the catalog loader for a JD template's structural scaffolding.
//
// DOCUMENT-READER: the language of a published job description is a property of
// the JD (the builder's "Output language" control → jd-build-run's `lang`), not of
// whoever pressed Generate — so the tokens come from the locale-pinned translator
// rather than `useTranslations()`. Same rule `jobsMarkdown.ts` follows for the
// copy-to-job-board posting, and `marketSalaryLabel` for its money label.
//
// Kept OUT of renderTemplate.ts because that module is imported by the template
// manager on the client; the renderer stays a pure function that takes its copy as
// a parameter.

/** Resolve every TEMPLATE_LOCALIZED_TOKEN for the JD's output language. */
export async function jdTemplateTokens(lang: string | null | undefined): Promise<TemplateTokens> {
  const t = await namespaceTranslator(isLocale(lang) ? lang : DEFAULT_LOCALE, "library.templates.token");
  // Built from the token tuple rather than a hand-written object literal, so the map
  // can never carry fewer keys than renderTemplate substitutes.
  //
  // A missing CATALOG entry is NOT loud, though: namespaceTranslator loads messages
  // dynamically (next-intl's compile-time key checking is off — see
  // catalog-translator.ts), and next-intl's missing-message fallback is the KEY PATH
  // itself, a perfectly non-empty string. So an absent key ships
  // "library.templates.token.heading_about" as a section heading on a live posting
  // rather than throwing. `jd-template-tokens.test.ts` is the guard that makes it
  // loud, rendering every token in all four locales.
  return Object.fromEntries(TEMPLATE_LOCALIZED_TOKENS.map((token) => [token, t(token)])) as TemplateTokens;
}
