import type { Locale } from "@/i18n/locales";

/**
 * Pin a candidate-facing link to the language its LETTER is written in.
 *
 * A link in an email is opened outside the app, where no NEXT_LOCALE cookie exists:
 * unpinned, the page resolves from Accept-Language, so a Czech candidate reading a
 * Czech offer letter on an English-configured browser lands on an English
 * accept/decline page. `proxy.ts` turns `?lang=` back into the cookie, which is the
 * convention every other candidate door already follows (status, erasure,
 * schedule). Idempotent: a link that already carries `lang=` is left alone, so a
 * caller that pinned upstream is never double-pinned.
 */
export function pinLinkLocale(link: string, locale: Locale): string {
  if (/[?&]lang=/.test(link)) return link;
  return `${link}${link.includes("?") ? "&" : "?"}lang=${encodeURIComponent(locale)}`;
}
