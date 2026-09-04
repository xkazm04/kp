"use server";

import { cookies } from "next/headers";
import { localeCookieOptions } from "./cookie";
import { isLocale, LOCALE_COOKIE, type Locale } from "./locales";

/** Persist the user's language choice in the `NEXT_LOCALE` cookie. Called by the
 *  client LanguageSwitcher; the caller follows with `router.refresh()` so the
 *  server re-renders under the new locale (request config reads this cookie).
 *  An unsupported value is ignored rather than written, so the cookie can never
 *  hold a locale we have no catalog for.
 *
 *  Options come from `localeCookieOptions()` — the ONE policy the three
 *  NEXT_LOCALE writers share (lifetime, scope, SameSite, secure-in-production). */
export async function setLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, localeCookieOptions());
}
