// Organization settings that cross the client/server boundary and feed LLM
// output. Mirrors the locale system (i18n/locales.ts + i18n/actions.ts): a single
// long-lived cookie is the source of truth, read server-side when generating +
// saving LLM output and client-side for form defaults (the JD builder company
// field). The app LANGUAGE is not duplicated here — it IS the app locale
// (NEXT_LOCALE), so org language flows through the existing getServerLocale path.

export const ORG_NAME_COOKIE = "kp_org_name";

// The seed corpus targets Česká spořitelna (the pilot customer — see the ČS
// seed), so an un-set org falls back to it: the JD builder and generated copy are
// branded out of the box until an operator changes it on Settings → Organization.
export const DEFAULT_ORG_NAME = "Česká spořitelna";

export const MAX_ORG_NAME = 80;

/** Trim, collapse runs of whitespace, and clamp a raw org-name input to a
 *  storable value. Applied at persist time (the server action) and read time. */
export function sanitizeOrgName(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_ORG_NAME);
}

// A cookie value may or may not arrive percent-encoded depending on the reader
// (document.cookie always is; next/headers may already decode). Decode only when
// it clearly is, so we never double-decode a raw name.
function decodeCookieValue(raw: string): string {
  if (raw.includes("%")) {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

/** A stored (possibly empty/missing/encoded) cookie value → the effective org
 *  name, falling back to the default when unset. */
export function resolveOrgName(rawStored: string | null | undefined): string {
  const clean = sanitizeOrgName(decodeCookieValue(rawStored ?? ""));
  return clean || DEFAULT_ORG_NAME;
}

/** Client-only: the effective org name from document.cookie. SSR-safe — returns
 *  the default when document is unavailable. */
export function readClientOrgName(): string {
  if (typeof document === "undefined") return DEFAULT_ORG_NAME;
  const entry = document.cookie.split("; ").find((c) => c.startsWith(`${ORG_NAME_COOKIE}=`));
  return resolveOrgName(entry ? entry.slice(ORG_NAME_COOKIE.length + 1) : null);
}
