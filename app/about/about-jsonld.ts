// Structured data for /about. Pure so a unit test can parse the graph against
// aboutPage.meta without rendering the Spark tree. The route shell is the only
// emitter — crawlers get a typed product page, not only Open Graph tags.

export const PRODUCT_NAME = "KandiDate";

export type AboutJsonLdInput = {
  /** Localized `aboutPage.meta.title` — the document title. */
  name: string;
  /** Localized `aboutPage.meta.description`. */
  description: string;
  /** Request locale (`en` / `cs` / `de` / `fr`). */
  inLanguage: string;
  /** Deployment origin (`siteUrl()`), trailing slash optional. */
  siteOrigin: string;
  /** `sourceRepoHref()` — AGPL source, advertised as sameAs. */
  sameAs: string;
};

function absoluteUrl(origin: string, path: string): string {
  return new URL(path, origin).href;
}

export function aboutPageUrl(origin: string): string {
  return absoluteUrl(origin, "/about");
}

export function homeUrl(origin: string): string {
  return absoluteUrl(origin, "/");
}

/** Escape so a description cannot close the <script> element. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function buildAboutJsonLd(input: AboutJsonLdInput): {
  "@context": "https://schema.org";
  "@graph": Record<string, unknown>[];
} {
  const aboutUrl = aboutPageUrl(input.siteOrigin);
  const home = homeUrl(input.siteOrigin);
  const website = { "@type": "WebSite", name: PRODUCT_NAME, url: home };
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "AboutPage",
        "@id": `${aboutUrl}#webpage`,
        name: input.name,
        description: input.description,
        url: aboutUrl,
        inLanguage: input.inLanguage,
        isPartOf: website,
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${aboutUrl}#app`,
        name: PRODUCT_NAME,
        description: input.description,
        url: aboutUrl,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        inLanguage: input.inLanguage,
        sameAs: input.sameAs,
        publisher: { "@type": "Organization", name: PRODUCT_NAME, url: home },
        // Hosted free tier is still on PricingSection (`id: "free"`). Do not
        // invent aggregateRating / review.
        offers: { "@type": "Offer", price: "0", priceCurrency: "CZK" },
      },
    ],
  };
}
