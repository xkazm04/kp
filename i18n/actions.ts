"use server";

import { cookies } from "next/headers";
import { localeCookieOptions } from "./cookie";
import { coerceLocale, LOCALE_COOKIE } from "./locales";

/** Persist the user's language choice in the `NEXT_LOCALE` cookie. Called by the
 *  client LanguageSwitcher; the caller follows with `router.refresh()` so the
 *  server re-renders under the new locale (request config reads this cookie).
 *  An unsupported value is ignored rather than written, so the cookie can never
 *  hold a locale we have no catalog for. Regional tags (`cs-CZ`) fold through
 *  {@link coerceLocale} onto a shipped catalog (`cs`); `isLocale` stays strict
 *  for catalog imports.
 *
 *  `"auto"` or `null` deletes the cookie (same path / SameSite / secure as the
 *  writer) so the next request falls through to Accept-Language. Invalid values
 *  stay no-ops.
 *
 *  Options come from `localeCookieOptions()` — the ONE policy the three
 *  NEXT_LOCALE writers share (lifetime, scope, SameSite, secure-in-production). */
export async function setLocale(locale: string | null): Promise<void> {
  const store = await cookies();
  if (locale === "auto" || locale === null) {
    const { path, sameSite, secure } = localeCookieOptions();
    store.delete({ name: LOCALE_COOKIE, path, sameSite, secure });
    return;
  }
  const folded = coerceLocale(locale);
  if (!folded) return;
  store.set(LOCALE_COOKIE, folded, localeCookieOptions());
}
