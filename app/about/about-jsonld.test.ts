import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOCALES } from "../../i18n/locales.ts";
import {
  PRODUCT_NAME,
  aboutPageUrl,
  buildAboutJsonLd,
  serializeJsonLd,
} from "./about-jsonld.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");

const catalog = (locale: string) =>
  JSON.parse(readFileSync(path.join(REPO, "messages", `${locale}.json`), "utf8")) as {
    aboutPage: { meta: { title: string; description: string } };
  };

function typesOf(node: Record<string, unknown>): string[] {
  const t = node["@type"];
  return Array.isArray(t) ? t.map(String) : [String(t)];
}

function graphOf(locale: string) {
  const meta = catalog(locale).aboutPage.meta;
  return buildAboutJsonLd({
    name: meta.title,
    description: meta.description,
    inLanguage: locale,
    siteOrigin: "https://kandidate.example",
    sameAs: "https://github.com/xkazm04/kp",
  });
}

test("the graph is an AboutPage plus SoftwareApplication in the request locale", () => {
  for (const locale of LOCALES) {
    const meta = catalog(locale).aboutPage.meta;
    const doc = graphOf(locale);
    const types = doc["@graph"].flatMap(typesOf);
    assert.ok(types.includes("AboutPage"), `${locale} missing AboutPage`);
    assert.ok(types.includes("SoftwareApplication"), `${locale} missing SoftwareApplication`);
    const page = doc["@graph"].find((n) => typesOf(n).includes("AboutPage"));
    assert.ok(page, `${locale} AboutPage node`);
    assert.equal(page.name, meta.title);
    assert.equal(page.description, meta.description);
    assert.equal(page.inLanguage, locale);
    assert.equal(page.url, aboutPageUrl("https://kandidate.example"));
    const part = page.isPartOf as Record<string, unknown>;
    assert.equal(part["@type"], "WebSite");
    assert.equal(part.name, PRODUCT_NAME);
  }
});

test("SoftwareApplication names the product, not a rating, and points at the source repo", () => {
  const doc = graphOf("en");
  const app = doc["@graph"].find((n) => typesOf(n).includes("SoftwareApplication"));
  assert.ok(app);
  assert.equal(app.name, PRODUCT_NAME);
  assert.equal(app.applicationCategory, "BusinessApplication");
  assert.equal(app.operatingSystem, "Web");
  assert.equal(app.sameAs, "https://github.com/xkazm04/kp");
  assert.equal(app.aggregateRating, undefined);
  assert.equal(app.review, undefined);
  const offers = app.offers as Record<string, unknown>;
  assert.equal(offers["@type"], "Offer");
  assert.equal(offers.price, "0");
  assert.equal(offers.priceCurrency, "CZK");
});

test("the free-tier Offer is claimed only while PricingSection still sells free", () => {
  const src = readFileSync(path.join(HERE, "..", "landing", "spark", "PricingSection.tsx"), "utf8");
  assert.match(src, /id:\s*"free"/, "PricingSection dropped the free tier — drop offers.price 0 from the graph");
});

test("serializeJsonLd cannot close a script element", () => {
  const raw = serializeJsonLd({ name: "</script><img>" });
  assert.equal(raw.includes("</script>"), false);
  assert.match(raw, /\\u003c/);
});
