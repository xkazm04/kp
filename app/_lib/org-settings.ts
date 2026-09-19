// Organization settings that cross the client/server boundary and feed LLM
// output. Mirrors the locale system (i18n/locales.ts + i18n/actions.ts): a single
// long-lived cookie is the source of truth, read server-side when generating +
// saving LLM output and client-side for form defaults (the JD builder company
// field). The app LANGUAGE is not duplicated here — it IS the app locale
// (NEXT_LOCALE), so org language flows through the existing getServerLocale path.

import { APP_CURRENCY } from "./format";

export const ORG_NAME_COOKIE = "kp_org_name";
export const ORG_CURRENCY_COOKIE = "kp_org_currency";

/** The currencies an organization can denominate its salary bands in. A LABEL
 *  choice, not FX: the app never converts, so a band typed in EUR is read in EUR
 *  (format.ts APP_CURRENCY stays the default for an org that never chose). */
export const ORG_CURRENCIES = [APP_CURRENCY, "EUR", "USD", "GBP", "PLN"] as const;
export type OrgCurrency = (typeof ORG_CURRENCIES)[number];

export function isOrgCurrency(value: unknown): value is OrgCurrency {
  return typeof value === "string" && (ORG_CURRENCIES as readonly string[]).includes(value);
}

/** A stored cookie value → the effective currency, the app default when unset or
 *  unrecognised (an old or hand-edited cookie must never label money with junk). */
export function resolveOrgCurrency(rawStored: string | null | undefined): OrgCurrency {
  const clean = (rawStored ?? "").trim().toUpperCase();
  return isOrgCurrency(clean) ? clean : APP_CURRENCY;
}

/** Client-only: the effective org currency from document.cookie (SSR → default). */
export function readClientOrgCurrency(): OrgCurrency {
  if (typeof document === "undefined") return APP_CURRENCY;
  const entry = document.cookie.split("; ").find((c) => c.startsWith(`${ORG_CURRENCY_COOKIE}=`));
  return resolveOrgCurrency(entry ? entry.slice(ORG_CURRENCY_COOKIE.length + 1) : null);
}

/** The currency as a reader of `locale` writes it: the koruna is "Kč" in Czech
 *  only and its ISO code everywhere else (operator ruling 2026-09-14). */
export function currencySymbol(currency: string, locale: string): string {
  return currency === "CZK" && locale === "cs" ? "Kč" : currency;
}

/** An already-formatted amount with its currency where the reader expects it:
 *  English puts the code first ("CZK 45–50k"), cs/de/fr after, joined by a
 *  no-break space so the unit never wraps away from its figure. */
export function withCurrency(amount: string, currency: string, locale: string): string {
  const unit = currencySymbol(currency, locale);
  return locale === "en" ? `${unit} ${amount}` : `${amount} ${unit}`;
}

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
