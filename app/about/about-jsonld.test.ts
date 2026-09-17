import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOCALES } from "../../i18n/locales.ts";
import { ABOUT_STEP_KEYS, aboutStepId } from "../landing/spark/about-art/shared.ts";
import {
  PRODUCT_NAME,
  aboutPageUrl,
  buildAboutJsonLd,
  plainIcu,
  serializeJsonLd,
} from "./about-jsonld.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");

const catalog = (locale: string) =>
  JSON.parse(readFileSync(path.join(REPO, "messages", `${locale}.json`), "utf8")) as {
    aboutPage: {
      meta: { title: string; description: string };
      hero: { title: string };
      steps: Record<string, { title: string; body: string }>;
    };
  };

function typesOf(node: Record<string, unknown>): string[] {
  const t = node["@type"];
  return Array.isArray(t) ? t.map(String) : [String(t)];
}

function graphOf(locale: string, withHowTo = false) {
  const page = catalog(locale).aboutPage;
  const origin = "https://kandidate.example";
  const aboutUrl = aboutPageUrl(origin);
  return buildAboutJsonLd({
    name: page.meta.title,
    description: page.meta.description,
    inLanguage: locale,
    siteOrigin: origin,
    sameAs: "https://github.com/xkazm04/kp",
    ...(withHowTo
      ? {
          howToName: plainIcu(page.hero.title),
          howToSteps: ABOUT_STEP_KEYS.map((key, i) => ({
            name: page.steps[key].title,
            text: page.steps[key].body,
            url: `${aboutUrl}#${aboutStepId(i)}`,
          })),
        }
      : {}),
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

test("plainIcu strips hero ICU tags to a single sentence", () => {
  assert.equal(
    plainIcu("Walk one hire down<br></br>the <emph>whole pipeline</emph>."),
    "Walk one hire down the whole pipeline."
  );
});

test("HowTo.step is one HowToStep per ABOUT_STEP_KEYS, names from the catalog", () => {
  for (const locale of LOCALES) {
    const steps = catalog(locale).aboutPage.steps;
    const doc = graphOf(locale, true);
    const howTo = doc["@graph"].find((n) => typesOf(n).includes("HowTo"));
    assert.ok(howTo, `${locale} missing HowTo`);
    assert.equal(howTo.name, plainIcu(catalog(locale).aboutPage.hero.title));
    const howToSteps = howTo.step as Record<string, unknown>[];
    assert.equal(howToSteps.length, ABOUT_STEP_KEYS.length);
    ABOUT_STEP_KEYS.forEach((key, i) => {
      assert.equal(howToSteps[i]["@type"], "HowToStep");
      assert.equal(howToSteps[i].position, i + 1);
      assert.equal(howToSteps[i].name, steps[key].title, `${locale} ${key} title`);
      assert.equal(howToSteps[i].text, steps[key].body);
      assert.equal(howToSteps[i].url, `${aboutPageUrl("https://kandidate.example")}#${aboutStepId(i)}`);
    });
  }
});
