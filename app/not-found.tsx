import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BTN_PRIMARY, EYEBROW, INTRO, PANEL, TITLE_DISPLAY } from "@/app/_components/ui/recipes";

// Root branded 404 — every unmatched URL and every `notFound()` thrown by a
// server page without its own not-found file (history/[slug], apply/[id],
// interview/[token], skill/[token], …) lands here instead of Next's unstyled
// default. Server component: the locale resolves through the same per-request
// path as every other server page (i18n/request.ts → cookie → Accept-Language
// → default), so the copy is bilingual without any client JS.
// This 404 renders per-request localized copy — getTranslations resolves the
// locale from the cookie/Accept-Language header, which is runtime data. Under
// Cache Components that can't be statically prerendered, so Block the route
// (render it dynamically at request time, its behavior before this flag).
export const instant = false;

export default async function NotFound() {
  const t = await getTranslations("resilience");
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-6">
      <div className={`${PANEL} animate-fade-in w-full max-w-md p-7 text-center`}>
        <p className={EYEBROW}>{t("notFoundEyebrow")}</p>
        <h1 className={`mt-2 ${TITLE_DISPLAY}`}>{t("notFoundTitle")}</h1>
        <p className={`mt-3 ${INTRO}`}>{t("notFoundBody")}</p>
        <Link href="/" className={`${BTN_PRIMARY} mt-6 h-10 px-4`}>
          {t("notFoundCta")}
        </Link>
      </div>
    </main>
  );
}
