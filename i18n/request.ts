import { getRequestConfig } from "next-intl/server";
import { getServerLocale } from "./server";

// next-intl in "without i18n routing" mode: there is no `[locale]` URL segment,
// so the active locale is resolved per-request from the cookie (set by the
// in-app switcher or the `?lang` proxy), falling back to Accept-Language and
// finally the default — see getServerLocale, the one resolution path shared with
// API routes.
export default getRequestConfig(async () => {
  const locale = await getServerLocale();
  // Relative path (not the `@/` alias) so the bundler can statically enumerate
  // the message catalogs for this dynamic import.
  const messages = (await import(`../messages/${locale}.json`)).default;
  return { locale, messages };
});
