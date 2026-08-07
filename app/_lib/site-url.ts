// Canonical absolute origin for the deployment, shared by metadataBase
// (app/layout.tsx), robots.ts and sitemap.ts so they can never disagree.
// Configured via NEXT_PUBLIC_SITE_URL (documented in .env.example); defaults to
// the project's own domain.
const DEFAULT_SITE_URL = "https://nuda.dev";

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
