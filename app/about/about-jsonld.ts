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
  /** Visible hero title, ICU tags stripped — HowTo.name. */
  howToName?: string;
  /** One HowToStep per visible /about phase, already in ABOUT_STEP_KEYS order. */
  howToSteps?: readonly { name: string; text: string; url: string }[];
  /** Localized Home label (`aboutPage.nav.home`). Position 2 uses `name`. */
  breadcrumbHomeName?: string;
};

/** Strip next-intl rich tags (`<br></br>`, `<emph>`) so JSON-LD carries plain text. */
export function plainIcu(value: string): string {
  return value
    .replace(/<br\s*\/?><\/br>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?emph>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

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
      ...(input.howToSteps && input.howToSteps.length > 0
        ? [
            {
              "@type": "HowTo",
              "@id": `${aboutUrl}#howto`,
              name: input.howToName || input.name,
              inLanguage: input.inLanguage,
              url: aboutUrl,
              step: input.howToSteps.map((s, i) => ({
                "@type": "HowToStep",
                position: i + 1,
                name: s.name,
                text: s.text,
                url: s.url,
              })),
            },
          ]
        : []),
      ...(input.breadcrumbHomeName
        ? [
            {
              "@type": "BreadcrumbList",
              "@id": `${aboutUrl}#breadcrumb`,
              itemListElement: [
                {
                  "@type": "ListItem",
                  position: 1,
                  name: input.breadcrumbHomeName,
                  item: home,
                },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: input.name,
                  item: aboutUrl,
                },
              ],
            },
          ]
        : []),
    ],
  };
}
