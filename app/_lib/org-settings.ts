// Organization settings that cross the client/server boundary and feed LLM
// output. The org NAME lives in organizations.name (decision 2026-10-22, see
// org-actions.ts); the `kp_org_name` cookie is only the LEGACY copy that is
// migrated into the row on first read. The currency is still a long-lived cookie
// (i18n/locales.ts + i18n/actions.ts is the model), read server-side when generating
// + saving LLM output and client-side for form defaults. The app LANGUAGE is not duplicated here — it IS the app locale
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
// seed), so the DEMO falls back to it: the JD builder is branded out of the box
// there. It is the demo's name and nothing else's: an install whose fixtures are
// NOT seeded (KP_EMPTY=1 — `npm run up`, `npm run dev:empty`) has no company until
// its owner names one, and must never present a real bank as theirs. Which install
// is which is a SERVER fact (`fixtureSeedEnabled`, db/seed-gate.ts) that a client
// component cannot read, so the root layout resolves `orgNameFallback` once and
// hands it down (BrandProvider → `useOrgNameFallback`). The constant also stays the
// sentinel for "not a name of your own" (getting-started.ts, SetupCompanyStep).
export const DEFAULT_ORG_NAME = "Česká spořitelna";

/** The effective org name when none was set: the demo's on a fixture-seeded
 *  install, otherwise EMPTY — every reader treats empty as "not named yet" and asks
 *  (an empty company field) rather than inventing one. Pure: the caller passes the
 *  seed gate's answer. */
export function orgNameFallback(fixturesSeeded: boolean): string {
  return fixturesSeeded ? DEFAULT_ORG_NAME : "";
}

/** What createOrganization writes when nobody gave a name. Not a name of the org's own. */
export const UNNAMED_ORG_NAME = "Untitled organization";

/** Has this organizations.name been chosen by a human? Empty, the creation placeholder
 *  and the seed corpus's demo name are all "not named yet" — the last because every
 *  fresh seeded install starts on it, and a legacy `kp_org_name` cookie may replace it. */
export function isOwnOrgName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  return n !== "" && n !== UNNAMED_ORG_NAME && n !== DEFAULT_ORG_NAME;
}

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
 *  name, `fallback` when unset. The fallback defaults to EMPTY: the demo's name is
 *  only ever passed in by a caller that knows fixtures are seeded (`orgNameFallback`). */
export function resolveOrgName(rawStored: string | null | undefined, fallback = ""): string {
  const clean = sanitizeOrgName(decodeCookieValue(rawStored ?? ""));
  return clean || fallback;
}

/** The org name a SERVER write fills a blank company with, from the three sources a
 *  request can reach, in order: the org's stored name (organizations.name),
 *  the deployment's white-label display name (brand row — the first-run wizard writes
 *  it too, and it is the only one a request from another browser can see), then the
 *  seed gate's fallback (the demo's company, or empty). Pure: the caller reads the
 *  three (`effectiveOrgName` in org-name-server.ts). */
export function pickOrgName(
  cookieRaw: string | null | undefined,
  brandDisplayName: string | null | undefined,
  fixturesSeeded: boolean
): string {
  return resolveOrgName(cookieRaw, sanitizeOrgName(brandDisplayName ?? "") || orgNameFallback(fixturesSeeded));
}

/** A company the user typed (or the parser read off their ad) always wins; only a
 *  blank one takes `fallback`. Undefined when both are blank, so a nameless install
 *  stores NULL exactly as before rather than an empty string. */
export function companyOrDefault(typed: unknown, fallback: string): string | undefined {
  const own = typeof typed === "string" ? typed.trim() : "";
  return own || fallback.trim() || undefined;
}

/** Client-only: the effective org name from document.cookie. SSR-safe — returns
 *  `fallback` when document is unavailable. Pass `useOrgNameFallback()`. */
export function readClientOrgName(fallback = ""): string {
  if (typeof document === "undefined") return fallback;
  const entry = document.cookie.split("; ").find((c) => c.startsWith(`${ORG_NAME_COOKIE}=`));
  return resolveOrgName(entry ? entry.slice(ORG_NAME_COOKIE.length + 1) : null, fallback);
}
