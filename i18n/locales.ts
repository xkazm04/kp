// Single source of truth for the locale universe. The `Locale` union, the
// runtime `isLocale` guard, and every consumer (request config, middleware,
// switcher, server action) are all derived from this one literal array — mirrors
// the WORKSPACE_TAB_IDS pattern in app/features/tabs.ts so the type and the guard
// can never drift. Adding a locale is a one-line edit here plus a messages/<x>.json.
export const LOCALES = ["en", "cs", "de", "fr"] as const;

export type Locale = (typeof LOCALES)[number];

// English is the default/fallback: an unset cookie, an unrecognised value, or a
// browser whose Accept-Language matches nothing here all resolve to "en".
export const DEFAULT_LOCALE: Locale = "en";

// The cookie the active locale is persisted in. `NEXT_LOCALE` is next-intl's
// conventional name; the switcher (server action) writes it and the request
// config reads it. Kept here so the name lives in exactly one place.
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Type guard: is `value` one of our supported locales? Used to reject a
 *  fat-fingered cookie / `?lang` / Accept-Language tag before it reaches a
 *  dynamic `import(messages/<locale>.json)` that would otherwise 404 at runtime. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Pick the best supported locale from an `Accept-Language` header, or null if
 *  none match. Matches on the PRIMARY subtag ("cs-CZ" -> "cs") and honours the
 *  header's own priority order (it is already sorted by q-value by the browser),
 *  so the first listed language we actually support wins. */
export function resolveAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase();
    if (!tag) continue;
    const primary = tag.split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}
