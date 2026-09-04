// One year — a chosen language should persist across sessions, not expire with the
// tab. The same lifetime is what a returning candidate expects from a `?lang=` link
// they were sent weeks ago.
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The shape `cookies().set(...)` / `res.cookies.set(...)` take for their options. */
export type LocaleCookieOptions = {
  path: string;
  maxAge: number;
  sameSite: "lax";
  secure: boolean;
};

/**
 * The ONE option set every `NEXT_LOCALE` writer uses.
 *
 * There are three of them — the language switcher's server action
 * (`i18n/actions.ts`), the Organization tab's `setOrgLanguage`
 * (`app/_lib/org-actions.ts`) and the `?lang=` middleware override (`proxy.ts`) —
 * and until this helper each re-typed its own `{path, maxAge, sameSite}` triple.
 * Three copies of a policy is three places a hardening has to land, and it already
 * showed: none of them set `secure`, so the locale cookie travelled in the clear
 * on an HTTPS deployment for no reason.
 *
 * `secure` is conditional rather than constant because a self-hosted install is
 * routinely reached over plain HTTP on a LAN (docs/architecture/self-hosting.md),
 * and a `secure` cookie is silently DROPPED by the browser there — the switcher
 * would appear to do nothing. Production is the only environment we can assume
 * TLS in, so that is where it is set; `NODE_ENV` is the same literal gate the rest
 * of the app uses and is statically known at build time.
 *
 * `sameSite: "lax"` (not "strict") is deliberate: a candidate following a
 * `?lang=cs` link from an email arrives cross-site on a top-level GET, and
 * "strict" would withhold the cookie on exactly that first navigation.
 *
 * Not `httpOnly`: the language is a display preference the client reads, and it
 * carries no authority — every server render resolves it through `isLocale()`
 * anyway, so a tampered value degrades to `en` rather than doing anything.
 */
export function localeCookieOptions(): LocaleCookieOptions {
  return {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  };
}

