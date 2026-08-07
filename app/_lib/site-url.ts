// Canonical absolute origin for the deployment, shared by metadataBase
// (app/layout.tsx), robots.ts and sitemap.ts so they can never disagree.
// Configured via NEXT_PUBLIC_SITE_URL (documented in .env.example). The
// fallback is a deliberately NEUTRAL placeholder (.example is the RFC 2606
// reserved TLD): it keeps `new URL()` valid and the build warning-free, but an
// unset origin should be obvious in emitted metadata rather than silently
// pointing at somebody's real domain. Every deployment must set
// NEXT_PUBLIC_SITE_URL.
const DEFAULT_SITE_URL = "https://kandidate.example";

// Resolve defensively: a malformed NEXT_PUBLIC_SITE_URL fed straight into
// `new URL()` would THROW at module load and crash the app on boot. Parse it,
// warn, and fall back — an un-set or fat-fingered origin must degrade
// gracefully, not take the site (or the robots/sitemap routes) down.
export function siteUrl(): URL {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (raw) {
    try {
      return new URL(raw);
    } catch {
      console.warn(
        `[site-url] Invalid NEXT_PUBLIC_SITE_URL ${JSON.stringify(raw)} — must be an absolute URL; ` +
          `falling back to ${DEFAULT_SITE_URL}.`
      );
    }
  }
  return new URL(DEFAULT_SITE_URL);
}
