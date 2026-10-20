import { getTranslations } from "next-intl/server";
import { sourceRepoHref } from "@/app/_lib/source-repo";
import { StartCta } from "../chrome/Ctas";
import { GLYPH } from "../chrome/glyphs";
import { Edge } from "./art/Edge";
import { PlanEmblem } from "./art/PricingArt";
import { TrackedLink } from "./art/TrackedLink";

/*
 * The pricing band (prototype `.sec.pricing#pricing`): the prototype's look (the
 * dark self-hosted door beside three paper plans, drawn emblems, the "open
 * source" ribbon, the packs line, the jump to Enterprise) over TODAY's price
 * list. Every name, price, cadence, USD line, bullet and button label is the
 * `landing.pricing.tiers.*` catalog that app/landing/spark/PricingSection.test.ts
 * pins to app/_lib/billing/plans.ts (the public number must equal the enforced
 * number); nothing here restates a figure.
 *
 * TIER_STYLES is the same table, in the same shape, as the retired
 * PricingSection's (id per tier, self-hosting first, `external` = leaves for the
 * repository instead of entering the workspace): PricingSection.test.ts and
 * app/about/about-jsonld.test.ts read it out of THIS file's source. The hosted
 * tiers' buttons are the chrome's StartCta carrying the plan (into the href, the
 * workspace entry and the `landing_cta_click` payload).
 *
 * One deliberate difference from the catalog: the self-hosted card's models
 * bullet. The catalog line names third-party runtimes; the approved prototype
 * words it without vendor names ("local or compatible servers"), which is
 * `siteLand.pricing.selfhostModels`. It is not a metered promise (the test's
 * meter bullets are the hosted tiers'), and the bullet count stays the catalog's.
 */
const TIER_STYLES = [
  { id: "selfhost", external: true, card: "card self" },
  { id: "free", external: false, card: "card plan" },
  { id: "starter", external: false, card: "card plan mid" },
  { id: "growth", external: false, card: "card plan" }
] as const;

type TierId = (typeof TIER_STYLES)[number]["id"];

/** Position of the self-hosted models bullet in `pricing.tiers.selfhost.features`. */
const SELFHOST_MODELS_BULLET = 1;

export type PricingProps = { signupOpen: boolean };

export default async function Pricing({ signupOpen }: PricingProps) {
  const t = await getTranslations("landing");
  const ts = await getTranslations("siteLand");

  const card = (tier: (typeof TIER_STYLES)[number]) => {
    const id: TierId = tier.id;
    const features = [...(t.raw(`pricing.tiers.${id}.features`) as string[])];
    if (id === "selfhost" && features.length > SELFHOST_MODELS_BULLET) {
      features[SELFHOST_MODELS_BULLET] = ts("pricing.selfhostModels");
    }
    const badge = t.has(`pricing.tiers.${id}.badge`) ? t(`pricing.tiers.${id}.badge`) : null;
    return (
      <article key={id} className={tier.card}>
        {badge ? <span className="rib">{badge}</span> : null}
        <PlanEmblem tier={id} />
        <h3>{t(`pricing.tiers.${id}.name`)}</h3>
        <p className="sub">{t(`pricing.tiers.${id}.tagline`)}</p>
        <p className="price">
          <b>{t(`pricing.tiers.${id}.price`)}</b> <small>{t(`pricing.tiers.${id}.cadence`)}</small>
        </p>
        <p className="tiny">{t(`pricing.tiers.${id}.usd`)}</p>
        <ul className="tick">
          {features.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
        {tier.external ? (
          <TrackedLink className="btn primary" href={sourceRepoHref()} external placement="pricing" plan={id}>
            {t(`pricing.tiers.${id}.cta`)} <span aria-hidden="true">{GLYPH.next}</span>
          </TrackedLink>
        ) : (
          <StartCta signupOpen={signupOpen} placement="pricing" plan={id} className="btn">
            {t(`pricing.tiers.${id}.cta`)}
          </StartCta>
        )}
      </article>
    );
  };

  const [self, ...plans] = TIER_STYLES;

  return (
    <section className="sec pricing" id="pricing" aria-labelledby="priceH">
      <Edge d="M0 60V20Q200 46 420 22T860 18T1240 30T1600 14V60Z" />
      <div className="wrap">
        <div className="sec-h split wide-l">
          <h2 id="priceH">{t.rich("pricing.heading", { br: () => <br />, emph: (chunks) => <span>{chunks}</span> })}</h2>
          <p className="lead">{ts("pricing.lead")}</p>
        </div>

        <div className="doors">
          {card(self)}
          <div className="plans">{plans.map(card)}</div>
        </div>
        <div className="pr-foot">
          <p className="packs">{t("pricing.footnote2")}</p>
          <a className="btn btn-sm" href="#enterprise">
            {ts("pricing.toEnterprise")} <span aria-hidden="true">{GLYPH.down}</span>
          </a>
        </div>
      </div>
    </section>
  );
}
