import type { MetadataRoute } from "next";
import { siteUrl } from "@/app/_lib/site-url";

// Crawl policy. Allow the public marketing surfaces (/, /about, /market) and
// keep crawlers out of the API and the per-token candidate pages — those are
// private one-off links (offer/schedule/status/data/interview/apply/onboarding/
// devcase/skill/invite), not indexable content, and some carry PII in the token.
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/offer/",
        "/schedule/",
        "/status/",
        "/data/",
        "/interview/",
        "/apply/",
        "/onboarding/",
        "/devcase/",
        "/skill/",
        "/invite/",
      ],
    },
    sitemap: new URL("/sitemap.xml", base).toString(),
    host: base.host,
  };
}
