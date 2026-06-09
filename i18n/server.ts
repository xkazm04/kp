import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, resolveAcceptLanguage, type Locale } from "./locales";

// Resolve the active locale in any server scope — route handlers, server
// components, server actions. The ONE resolution path (cookie → Accept-Language
// → default), shared by i18n/request.ts (rendering) and API routes that need to
// thread the locale into a backend call (e.g. /api/analyze forwarding `--lang`
// to the Python pipeline so the LLM narrative comes back in the right language).
export async function getServerLocale(): Promise<Locale> {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const fromHeader = resolveAcceptLanguage((await headers()).get("accept-language"));
  return fromHeader ?? DEFAULT_LOCALE;
}
