import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PACKS, PLANS, PLAN_IDS, type Meter, type PlanId } from "../../_lib/billing/plans.ts";

/*
 * The landing pricing band is a PRICE LIST, not decoration: every bullet on it is a
 * checkable promise a prospect can hold the product to, and it is published in four
 * languages on a page nobody re-reads. Nothing coupled it to the code that enforces
 * those promises — `app/_lib/billing/plans.ts` — so a retune there (the tiers were
 * last retuned 2026-07-05) silently falsifies four public catalogs at once, and a
 * withdrawn tier (`legacy: true`, e.g. BYOM) could keep selling itself from the page
 * while `isSelfServePlan` refuses its checkout.
 *
 * These pin the seam in the only direction that matters: the PUBLIC number must equal
 * the ENFORCED number. They read the shipped catalogs and the shipped tier list rather
 * than a copy, so there is nothing to keep in sync — PricingSection.tsx itself imports
 * framer-motion/next-intl and cannot be imported here, so its tier table is read from
 * source the way app/api/analyze/analyze-gate-tenancy.test.ts reads its route.
 *
 * The locale sweep covers a dimension `npm run i18n:check` does not: it compares keys,
 * not the LENGTH or the CONTENT of array-valued messages, so a tier that lost a bullet
 * — or gained a different number — in cs/de/fr is a different offer, unnoticed.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..", "..");
const LOCALES = ["en", "cs", "de", "fr"] as const;

type Catalog = {
  landing: {
    pricing: {
      footnote2: string;
      tiers: Record<string, { price: string; usd: string; features: string[] }>;
      enterprise: { capabilities: string[] };
    };
  };
};

const catalog = (locale: string): Catalog =>
  JSON.parse(readFileSync(path.join(REPO, "messages", `${locale}.json`), "utf8")) as Catalog;

const en = catalog("en");

/** The tier ids the section actually renders, read out of its own TIER_STYLES table. */
function renderedTierIds(): string[] {
  const src = readFileSync(path.join(HERE, "PricingSection.tsx"), "utf8");
  const start = src.indexOf("const TIER_STYLES");
  assert.ok(start >= 0, "PricingSection still declares a TIER_STYLES table");
  const block = src.slice(start, src.indexOf("] as const;", start));
  return [...block.matchAll(/\bid:\s*"([a-z_]+)"/g)].map((m) => m[1]);
}

/** Digits as a human reads them, with the locale's grouping separator (",", ".", NBSP,
 *  narrow NBSP or a plain space) collapsed only where it sits BETWEEN two digits. */
function numbersIn(text: string): number[] {
  const flat = text.replace(/(\d)[\s  ,.](?=\d)/g, "$1");
  return [...flat.matchAll(/\d+/g)].map((m) => Number(m[0]));
}

// One bullet per metered promise. Deliberately anchored (`\b…s?\b`) so a future bullet
// that merely mentions hiring can't be mistaken for the hire allowance.
const METER_BULLET: Record<Meter, RegExp> = {
  job_posts: /\bpublished roles?\b/i,
  hires: /\bhires?\b/i,
  ai_candidates: /\bAI candidates?\b/i,
  case_designs: /\bcases?\b/i,
  interview_minutes: /\binterview minutes?\b/i,
};

const HOSTED_TIERS = ["free", "starter", "growth"] as const;

test("the pricing band sells exactly the plans the billing catalog still sells", () => {
  const rendered = renderedTierIds();
  const isPlan = (id: string): id is PlanId => (PLAN_IDS as readonly string[]).includes(id);
  const renderedPlans = rendered.filter(isPlan);

  for (const id of renderedPlans) {
    assert.equal(PLANS[id].legacy ?? false, false, `${id} is withdrawn from sale but still on the pricing page`);
    assert.equal(
      PLANS[id].contactSales ?? false,
      false,
      `${id} is a contact-sales tier and belongs in the enterprise band, not the self-serve grid`
    );
  }

  const sellable = PLAN_IDS.filter((id) => !PLANS[id].legacy && !PLANS[id].contactSales);
  assert.deepEqual(
    [...renderedPlans].sort(),
    [...sellable].sort(),
    "every self-serve plan the catalog defines must appear on the pricing page, and nothing else"
  );
  // "selfhost" is not a billing plan at all (AGPL-3.0, unmetered) — it must stay off
  // the catalog and on the page.
  assert.ok(rendered.includes("selfhost"), "the self-hosted tier leads the band");
  assert.ok(!isPlan("selfhost"), "self-hosting must never become a metered plan id");
});

test("each hosted tier's bullets state the allowance the meter gate enforces", () => {
  for (const tier of HOSTED_TIERS) {
    const features = en.landing.pricing.tiers[tier].features;
    assert.ok(Array.isArray(features) && features.length > 0, `${tier} has feature bullets`);

    for (const [meter, pattern] of Object.entries(METER_BULLET) as [Meter, RegExp][]) {
      const matches = features.filter((f) => pattern.test(f));
      const limit = PLANS[tier].limits[meter];

      if (limit === 0) {
        // A zero allowance must not be advertised: Free has no interview minutes, so a
        // bullet promising them would sell an action that 402s on first use.
        assert.equal(matches.length, 0, `${tier} advertises ${meter}, which its plan sets to 0`);
        continue;
      }
      if (matches.length === 0) continue; // unlisted allowance (case designs) — no claim, nothing to check
      assert.equal(matches.length, 1, `${tier} states its ${meter} allowance in exactly one bullet`);

      const stated = numbersIn(matches[0]);
      assert.equal(stated.length, 1, `the ${tier} ${meter} bullet states exactly one figure: "${matches[0]}"`);
      assert.equal(
        stated[0],
        limit,
        `the pricing page promises ${stated[0]} for ${tier}/${meter}, the meter gate enforces ${limit}`
      );
    }

    // The two outcome meters are the headline of an outcome-priced product: every
    // hosted tier must state both, so "3 roles / 2 hires" can never quietly vanish.
    for (const meter of ["job_posts", "hires"] as const) {
      assert.ok(
        features.some((f) => METER_BULLET[meter].test(f)),
        `${tier} must state its ${meter} allowance`
      );
    }
  }
});

test("the displayed price is the catalogued price", () => {
  for (const tier of HOSTED_TIERS) {
    const { price, usd } = en.landing.pricing.tiers[tier];
    assert.deepEqual(numbersIn(price), [PLANS[tier].priceCzk], `${tier} shows its catalogued CZK price`);
    assert.ok(price.includes("Kč"), `${tier} prices in CZK, the primary display currency`);
    if (PLANS[tier].priceUsdApprox > 0) {
      assert.ok(
        numbersIn(usd).includes(PLANS[tier].priceUsdApprox),
        `${tier}'s approximate USD line (“${usd}”) must match priceUsdApprox`
      );
    }
  }
  // The self-hosted tier is the AGPL build: free forever, and priced nowhere in the
  // billing catalog. Its "0" is the claim to protect.
  assert.deepEqual(numbersIn(en.landing.pricing.tiers.selfhost.price), [0], "self-hosting is free");
});

test("the top-up footnote sells the pack the billing catalog actually stocks", () => {
  const pack = PACKS.minutes_100;
  const stated = numbersIn(en.landing.pricing.footnote2);
  assert.ok(stated.includes(pack.qty), `the footnote states the pack size (${pack.qty} minutes)`);
  assert.ok(stated.includes(pack.priceCzk), `the footnote states the pack price (${pack.priceCzk} Kč)`);
});

test("every locale offers the same tiers, the same bullets and the same figures", () => {
  const enTiers = en.landing.pricing.tiers;
  for (const locale of LOCALES) {
    if (locale === "en") continue;
    const tiers = catalog(locale).landing.pricing.tiers;
    assert.deepEqual(Object.keys(tiers).sort(), Object.keys(enTiers).sort(), `${locale} lists the same tiers`);

    for (const [id, tier] of Object.entries(enTiers)) {
      // A missing bullet in cs/de/fr is a different offer, and i18n:check compares
      // keys rather than array lengths, so nothing else catches it.
      assert.equal(
        tiers[id].features.length,
        tier.features.length,
        `${locale} offers ${tiers[id].features.length} bullets on ${id}, en offers ${tier.features.length}`
      );
      assert.deepEqual(
        numbersIn(tiers[id].features.join(" ")).sort((a, b) => a - b),
        numbersIn(tier.features.join(" ")).sort((a, b) => a - b),
        `${locale} promises different figures on ${id} than en does`
      );
      assert.deepEqual(numbersIn(tiers[id].price), numbersIn(tier.price), `${locale} prices ${id} differently`);
    }

    assert.equal(
      catalog(locale).landing.pricing.enterprise.capabilities.length,
      en.landing.pricing.enterprise.capabilities.length,
      `${locale} lists a different number of enterprise capabilities`
    );
  }
});
