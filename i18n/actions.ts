"use server";

import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE, type Locale } from "./locales";

// One year — the chosen language should persist across sessions, not expire with
// the tab. Matches the `?lang` middleware so a switcher click and a shared link
// write the same long-lived cookie.
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Persist the user's language choice in the `NEXT_LOCALE` cookie. Called by the
 *  client LanguageSwitcher; the caller follows with `router.refresh()` so the
 *  server re-renders under the new locale (request config reads this cookie).
 *  An unsupported value is ignored rather than written, so the cookie can never
 *  hold a locale we have no catalog for. */
export async function setLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
  });
}
