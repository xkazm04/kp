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
 *  dynamic `import(messages/<locale>.json)` that would otherwise 404 at runtime.
 *  Strict: a regional tag (`cs-CZ`) is NOT a catalog name. Writers fold those
 *  through {@link coerceLocale} first. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Fold an arbitrary language tag onto a shipped catalog locale, or null.
 *
 *  Lowercases, strips, then accepts the whole tag or its primary subtag when
 *  that subtag is a `LOCALES` member (`cs-CZ` → `cs`, `DE-de` → `de`). Unsupported
 *  families (`es-ES`) and path-like junk (`../en`) stay null so a writer never
 *  stores a value `import(messages/<locale>.json)` cannot load.
 *
 *  THE entry for `?lang=` (proxy) and `setLocale`. `isLocale` stays strict. */
export function coerceLocale(value: unknown): Locale | null {
  if (typeof value !== "string") return null;
  const tag = value.trim().toLowerCase();
  if (!tag) return null;
  if (isLocale(tag)) return tag;
  const primary = tag.split("-")[0];
  return primary !== tag && isLocale(primary) ? primary : null;
}

/** RFC 9110 q=0 means "not acceptable". Invalid / missing q is treated as present
 *  so we never reorder the header — the browser already sorted it. */
function isUnacceptableQ(params: readonly string[]): boolean {
  for (const raw of params) {
    const param = raw.trim();
    if (!param.toLowerCase().startsWith("q=")) continue;
    const value = param.slice(2).trim();
    if (value === "") return false;
    const q = Number(value);
    if (!Number.isFinite(q)) return false;
    return q === 0;
  }
  return false;
}

/** Pick the best supported locale from an `Accept-Language` header, or null if
 *  none match. Matches on the PRIMARY subtag ("cs-CZ" -> "cs") and honours the
 *  header's own priority order (it is already sorted by q-value by the browser),
 *  so the first listed language we actually support wins. Tags with `q=0` are
 *  skipped (RFC 9110: not acceptable); the list is never re-sorted by q. */
export function resolveAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const [tag, ...params] = part.split(";");
    if (isUnacceptableQ(params)) continue;
    const folded = coerceLocale(tag);
    if (folded) return folded;
  }
  return null;
}
