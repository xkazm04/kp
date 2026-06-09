import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap"
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  weight: ["400", "500", "600", "700"]
});

const SITE_TITLE = "KP Job Fit & Salary Estimator";
const SITE_DESCRIPTION = "AI-assisted CV seniority scoring and salary estimation pipeline for the Czech market.";

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

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
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
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: "en_US"
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION
  }
};

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
