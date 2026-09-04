import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Bricolage_Grotesque, Fraunces, Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { DevInspector } from "./_dev-inspector/DevInspector";
import { Toaster } from "./_components/Toast";
import { BrandStyle } from "./_components/BrandStyle";
import { BrandProvider } from "./_components/BrandProvider";
import { getBrand } from "./_lib/brand-store";
import { DEFAULT_BRAND } from "./_lib/brand-config";
import { DARK, PAPER } from "./_lib/brand";
import { siteUrl } from "./_lib/site-url";
import { LOCALES } from "@/i18n/locales";
import { PlausibleScript } from "./_lib/analytics/plausible";
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

// English fallbacks for when the `meta` catalog lacks a key — the catalog is the
// source of truth (all four locales carry meta.title/description); these only
// cover a partial catalog.
const SITE_TITLE = "KandiDate | Verified AI hiring, sealed decisions";
const SITE_DESCRIPTION =
  "KandiDate screens CVs, runs AI voice interviews and verifies work samples against AI delegation, with every hiring decision sealed into an auditable trail a human signs.";

// Brand name, not copy — never localized (the Wordmark rule).
const BRAND = "KandiDate";

// SHELL5 — BCP-47 → OpenGraph locale code (underscored region form og:locale
// expects). Covers the whole LOCALES universe (en/cs/de/fr) — `de`/`fr` were the
// drift this map once had, where a German share unfurled as `og:locale en_US`
// under a `<html lang="de">` document; both have been mapped since. Keep it in
// lockstep with i18n/locales.ts: a locale added there and forgotten here silently
// falls back to en_US rather than failing.
const OG_LOCALE: Record<string, string> = { en: "en_US", cs: "cs_CZ", de: "de_DE", fr: "fr_FR" };

// Anchors metadataBase (and so relative OG/Twitter/canonical URLs) to an
// absolute origin. Shared with robots.ts/sitemap.ts via app/_lib/site-url.ts so
// the three can never disagree — the layout used to carry its own copy of the
// same resolver, which is exactly the kind of duplication that drifts.
// Overridable per deploy via NEXT_PUBLIC_SITE_URL (documented in .env.example).
const SITE_URL = siteUrl();

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
    applicationName: BRAND,
    authors: [{ name: "Michal Kazdan" }],
    creator: "Michal Kazdan",
    keywords: [
      "verified work samples",
      "AI hiring",
      "anti-AI-cheating",
      "voice interviews",
      "auditable hiring decisions",
      "CV screening",
      "Czech market"
    ],
    // Per-route canonical: a relative "./" is resolved against the CURRENT
    // pathname and then metadataBase (resolveAbsoluteUrlWithPathname in Next's
    // metadata resolver), so every page canonicalizes to itself on the
    // configured origin — killing www/query-param duplicates without pinning
    // every route to the site root.
    // `languages` teaches a crawler that the four `?lang=` variants of THIS page
    // are the same document in another language rather than four thin duplicates
    // (which is how the shared JD links — `/jds/<slug>?lang=cs` — had been read).
    // Values are relative for the same reason canonical is: Next resolves each
    // against the current pathname, so every route advertises its own
    // alternates. `x-default` names the fallback for a reader whose language
    // matches none of them — the same answer i18n/locales.ts's DEFAULT_LOCALE
    // gives on the server. The proxy turns `?lang=` into the NEXT_LOCALE cookie,
    // so these URLs really do serve the language they claim.
    alternates: {
      canonical: "./",
      languages: {
        ...Object.fromEntries(LOCALES.map((l) => [l, `./?lang=${l}`])),
        "x-default": "./"
      }
    },
    openGraph: {
      type: "website",
      siteName: BRAND,
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
    // <meta name="theme-color"> cannot take a var(), so these read the JS mirror
    // of the canvas token — pinned to --color-paper (light + dark) by design:check.
    { media: "(prefers-color-scheme: light)", color: PAPER },
    { media: "(prefers-color-scheme: dark)", color: DARK.PAPER }
  ]
};

// Pre-hydration theme bootstrap (paired with NavRailPreferences + the
// [data-theme="dark"] seam in globals.css). Runs inline before first paint:
// an explicit choice in localStorage wins, otherwise prefers-color-scheme
// decides — so a dark-theme user never sees a light flash. Must stay a plain
// string evaluated synchronously; a React effect would run after paint.
// The marketing surfaces are hard-exempt (docs/design/README.md): a fixed Spark art
// direction in literal hexes that must always render in the light register, so
// the dark attribute is never set there regardless of the visitor's stored choice
// or OS preference. The membership test is objective and mechanical — a route
// whose page.tsx renders a component out of `app/landing/`, the same directory
// `npm run design:check` exempts from the token law — and
// `app/shell-headers.test.ts` derives that set from the source tree and fails when
// this list falls behind it. It fell behind once already: `/market` (MarketPulse,
// 87 literal hexes, zero `dark:` variants) shipped outside the list, so a
// dark-preference visitor got `data-theme="dark"` on a document whose art never
// moves.
//
// '/' is the fourth case and cannot be decided by path alone: it serves the
// landing to a visitor who has not entered the workspace and the dashboard to one
// who has. "Entered" is the readable kp_entered cookie (app/_lib/auth/session.ts)
// — set on sign-in, cleared on sign-out — the SAME signal the '/' server gate uses
// (in open mode), so this pre-paint choice can't disagree with what the server
// actually renders. Env-agnostic now that '/' serves the landing in both dev and prod.
const THEME_FIXED_ART_PATHS = ["/about", "/market"];
const THEME_SKIP_DARK = `var p=location.pathname,x=${JSON.stringify(THEME_FIXED_ART_PATHS)};for(var i=0;i<x.length;i++)if(p===x[i]||p.indexOf(x[i]+"/")===0)return;if(p==="/"&&!/(?:^|; )kp_entered=1/.test(document.cookie))return;`;
const THEME_INIT = `(function(){try{${THEME_SKIP_DARK}var t=localStorage.getItem("kp-theme");if(t!=="dark"&&t!=="light")t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";if(t==="dark")document.documentElement.dataset.theme="dark"}catch(e){}})()`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Locale + catalog are resolved per-request in i18n/request.ts (cookie/header).
  // `<html lang>` now tracks the active locale, and the provider hands the
  // catalog to every client component's useTranslations().
  const locale = await getLocale();
  const messages = await getMessages();
  // The CSP nonce proxy.ts minted for THIS request. Next stamps it onto every
  // script IT emits (framework bundles, the RSC payload chunks) by reading the
  // forwarded Content-Security-Policy header; the pre-paint theme script below is
  // the one script this app writes by hand, so it is the one that has to ask.
  // Null whenever the proxy did not run (a build-time prerender) — the attribute
  // is then omitted, which is why the policy is report-only until an owner flips
  // it. This layout is already dynamic (getLocale reads cookies/headers), so a
  // real request always renders with the nonce.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
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
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {/* Plausible (cookieless, env-gated on NEXT_PUBLIC_PLAUSIBLE_DOMAIN —
            renders nothing when unset). Its default pageview covers the landing
            view; custom funnel events go through track() in
            app/_lib/analytics/plausible.tsx. */}
        <PlausibleScript />
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
