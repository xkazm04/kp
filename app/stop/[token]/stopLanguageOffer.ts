// The stop page's language offer, as a pure decision so it is unit-testable (kp cannot
// import a .tsx in node:test). The page shows which language our letters go out in and,
// when the reader is looking at the page in a DIFFERENT language and has not stated a
// choice yet, offers that language in one click: a person reading this page in English
// about Czech letters is the clearest signal we will ever get short of asking.
//
// After a choice the page stops suggesting: the page language may just be a stale
// cookie or a forwarded link, and it must never nag someone who already told us. The
// remaining languages stay available as plain choices either way.
import { LOCALES, isLocale, type Locale } from "@/i18n/locales";

export type StopLanguageFacts = { letterLocale: string; localeChosen: boolean };

export function stopLanguageOffer(facts: StopLanguageFacts, pageLocale: string): { suggest: Locale } | null {
  if (!isLocale(facts.letterLocale) || !isLocale(pageLocale)) return null;
  if (facts.localeChosen) return null;
  if (pageLocale === facts.letterLocale) return null;
  return { suggest: pageLocale };
}

/** The languages offered as plain choices: every app locale except the one letters
 *  already go out in and the one already offered as the one-click suggestion. */
export function otherLetterLocales(letterLocale: string, suggest: Locale | null): Locale[] {
  return LOCALES.filter((l) => l !== letterLocale && l !== suggest);
}
