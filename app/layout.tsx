import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Fraunces, Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { DevInspector } from "./_dev-inspector/DevInspector";
import { Toaster } from "./_components/Toast";
import { BrandStyle } from "./_components/BrandStyle";
import { BrandProvider } from "./_components/BrandProvider";
import { getBrand } from "./_lib/brand-store";
import { DEFAULT_BRAND } from "./_lib/brand-config";
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

// Spark Dark's display face (the landing's Bricolage). In dark mode the
// --font-serif token resolves to it (globals.css), so every `font-serif`
// heading swaps register with the theme.
const bricolage = Bricolage_Grotesque({
  subsets: ["latin", "latin-ext"],
  variable: "--font-bricolage",
  display: "swap"
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

// Mobile viewport contract. `viewportFit: "cover"` is load-bearing: without it
// iOS pins every env(safe-area-inset-*) to 0px permanently, so the safe-area
// padding on the fixed chrome (control dock, orb, toasts, mobile drawer) could
// never take effect. themeColor keeps the mobile browser chrome in the page's
// register — it can only follow the OS preference (media queries are the only
// dial the meta supports), which matches the theme bootstrap's default; an
// explicit in-app override may diverge, which beats the always-light chrome.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdf8ee" },
    { media: "(prefers-color-scheme: dark)", color: "#141b24" }
  ]
};

// Pre-hydration theme bootstrap (paired with ThemeToggle + the
// [data-theme="dark"] seam in globals.css). Runs inline before first paint:
// an explicit choice in localStorage wins, otherwise prefers-color-scheme
// decides — so a dark-theme user never sees a light flash. Must stay a plain
// string evaluated synchronously; a React effect would run after paint.
// The marketing surfaces are hard-exempt (docs/design/README.md): a fixed Spark art
// direction in literal hexes that must always render in the light register, so
// the dark attribute is never set there regardless of the visitor's stored choice
// or OS preference. Those surfaces are the public /about page (always) and the
// home landing at '/' whenever the visitor hasn't entered the workspace. "Entered"
// is the readable kp_entered cookie (app/_lib/auth/session.ts) — set on sign-in,
// cleared on sign-out — the SAME signal the '/' server gate uses (in open mode),
// so this pre-paint choice can't disagree with what the server actually renders.
// Env-agnostic now that '/' serves the landing in both dev and prod.
const THEME_SKIP_DARK = `var p=location.pathname;if(p.indexOf("/about")===0||(p==="/"&&!/(?:^|; )kp_entered=1/.test(document.cookie)))return;`;
const THEME_INIT = `(function(){try{${THEME_SKIP_DARK}var t=localStorage.getItem("kp-theme");if(t!=="dark"&&t!=="light")t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";if(t==="dark")document.documentElement.dataset.theme="dark"}catch(e){}})()`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Locale + catalog are resolved per-request in i18n/request.ts (cookie/header).
  // `<html lang>` now tracks the active locale, and the provider hands the
  // catalog to every client component's useTranslations().
  const locale = await getLocale();
  const messages = await getMessages();
  // White-label brand (E3/E-BRD-3), read ONCE here: the accent goes to BrandStyle
  // (CSS-var override) and the whole config seeds BrandProvider so client components
  // (both sidebars, candidate headers) render the name/logo with no fetch/flash. A
  // brand-read fault must never break the shell.
  let brand = DEFAULT_BRAND;
  try {
    brand = getBrand();
  } catch (error) {
    console.error("[layout] brand read failed", error);
  }
  // suppressHydrationWarning: the theme script mutates <html data-theme> before
  // React hydrates, so the server/client attribute mismatch is expected.
  return (
    <html lang={locale} className={`${inter.variable} ${fraunces.variable} ${bricolage.variable}`} suppressHydrationWarning>
      <body className="font-sans">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {/* White-label accent override (E3) — after globals.css so it wins by source order. */}
        <BrandStyle accent={brand.accentColor} />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <BrandProvider brand={brand}>
            {children}
            {/* Feedback layer — one portal stack for the whole app (workspace AND
                the public token pages), inside the intl provider so the dismiss
                label localizes. See app/_components/Toast.tsx. */}
            <Toaster />
          </BrandProvider>
        </NextIntlClientProvider>
        {process.env.NODE_ENV === "development" && <DevInspector />}
      </body>
    </html>
  );
}
