import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "./globals.css";

// SHELL5 — `latin-ext` carries the Czech diacritics (ě š č ř ž ů, all over
// messages/cs.json). Without it the cs UI rendered those glyphs in a fallback
// font; including the block makes the serif headings and body match in both
// languages.
const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap"
});

const fraunces = Fraunces({
  subsets: ["latin", "latin-ext"],
  variable: "--font-fraunces",
  display: "swap",
  weight: ["400", "500", "600", "700"]
});

const SITE_TITLE = "KP Job Fit & Salary Estimator";
const SITE_DESCRIPTION = "AI-assisted CV seniority scoring and salary estimation pipeline for the Czech market.";

// SHELL5 — BCP-47 → OpenGraph locale code (underscored region form og:locale
// expects). Keep in sync with the LOCALES universe.
const OG_LOCALE: Record<string, string> = { en: "en_US", cs: "cs_CZ" };

// Anchors relative OG/Twitter image URLs to an absolute origin. Without it Next
// falls back to http://localhost:3000 and warns at build. Overridable per deploy
// via NEXT_PUBLIC_SITE_URL (documented in .env.example); defaults to the project's
// own domain.
const DEFAULT_SITE_URL = "https://nuda.dev";

// Resolve metadataBase defensively: a malformed NEXT_PUBLIC_SITE_URL fed straight
// into `new URL()` would THROW at module load and crash the whole app on boot.
// Parse it, warn, and fall back to the default instead — an un-set or fat-fingered
// origin must degrade gracefully, not take the site down.
function resolveSiteUrl(): URL {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (raw) {
    try {
      return new URL(raw);
    } catch {
      console.warn(
        `[layout] Invalid NEXT_PUBLIC_SITE_URL ${JSON.stringify(raw)} — must be an absolute URL; ` +
          `falling back to ${DEFAULT_SITE_URL}.`
      );
    }
  }
  return new URL(DEFAULT_SITE_URL);
}

const SITE_URL = resolveSiteUrl();

// SHELL5 — locale-aware metadata: `<title>`/description/OG now follow the active
// locale (resolved per-request, the same path as `<html lang>`) instead of
// staying English with `og:locale en_US` under a `cs` document. The title/
// description/OG strings come from the `meta` catalog; the rest is locale-
// invariant. (The opengraph-image route stays intentionally English — localizing
// the rendered image needs latin-ext glyph loading in pickFontUrl, out of scope.)
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations("meta");
  const title = t.has("title") ? t("title") : SITE_TITLE;
  const description = t.has("description") ? t("description") : SITE_DESCRIPTION;
  return {
    metadataBase: SITE_URL,
    title,
    description,
    applicationName: "KP Job Fit & Salary Estimator",
    authors: [{ name: "Michal Kazdan", url: "https://nuda.dev" }],
    creator: "Michal Kazdan",
    keywords: [
      "CV scoring",
      "job fit",
      "salary estimation",
      "Czech market",
      "seniority assessment",
      "AI hiring tools"
    ],
    openGraph: {
      type: "website",
      siteName: SITE_TITLE,
      title,
      description,
      locale: OG_LOCALE[locale] ?? "en_US"
    },
    twitter: {
      card: "summary_large_image",
      title,
      description
    }
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Locale + catalog are resolved per-request in i18n/request.ts (cookie/header).
  // `<html lang>` now tracks the active locale, and the provider hands the
  // catalog to every client component's useTranslations().
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} className={`${inter.variable} ${fraunces.variable}`}>
      <body className="font-sans">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
