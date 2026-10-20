import { Fragment, isValidElement, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { DemoCta, StartCta } from "../chrome/Ctas";
import { GLYPH } from "../chrome/glyphs";
import { HeroSky, HeroSun, SparkGlyph } from "./art/HeroArt";
import { SAMPLE, SIGNER } from "./art/samples";
import { TrackedLink } from "./art/TrackedLink";
import { headlineFit } from "./headlineFit";
import { AutoPill, HeroPile, HeroShell, type PileCardData } from "./HeroClient";

/*
 * The hero (prototype index.html `.hero#top`): the poster. Headline with the
 * "autopilot" switch, the lede, the open-source line with its "Run it yourself"
 * link to the self-hosted card, the two calls to action (the chrome's StartCta /
 * DemoCta), and the scene: the sun dial, Kandi, the flecks, the handwritten note,
 * the pile of three sample CVs and the hills.
 *
 * Server-rendered copy and art; HeroShell (client) owns the switch, the pile, the
 * intro and the parallax (see HeroClient.tsx). The headline is today's
 * `landing.hero.title` (translated in four languages): its <br> splits it into
 * the prototype's two lines and its <emph> becomes the switch.
 */
export type HeroProps = { signupOpen: boolean };

/** Marker for the headline's line break; never rendered. */
function LineBreak() {
  return null;
}

function flatten(node: ReactNode): ReactNode[] {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (isValidElement<{ children?: ReactNode }>(node) && node.type === Fragment) return flatten(node.props.children);
  return [node];
}

/** A rich message's nodes on either side of its first <br>. */
function splitAtBreak(rich: ReactNode): [ReactNode, ReactNode] {
  const nodes = flatten(rich);
  const at = nodes.findIndex((n) => isValidElement(n) && n.type === LineBreak);
  const keyed = (list: ReactNode[]) => list.map((n, i) => <Fragment key={i}>{n}</Fragment>);
  if (at < 0) return [keyed(nodes), null];
  return [keyed(nodes.slice(0, at)), keyed(nodes.slice(at + 1))];
}

/** The mascot's rendered width: 572 design px of 1600 on a desktop, up to 380px on a phone. */
const KANDI_SIZES = "(max-width: 1099px) min(84vw, 380px), 36vw";

export default async function Hero({ signupOpen }: HeroProps) {
  const t = await getTranslations("landing");
  const ts = await getTranslations("siteLand");

  const [line1, line2] = splitAtBreak(
    t.rich("hero.title", {
      br: () => <LineBreak />,
      emph: (chunks) => <AutoPill>{chunks}</AutoPill>
    })
  );

  // The headline's widths in em: the CSS sets a line smaller only where it would overflow (French; Czech and
  // German on phones), so every locale that fits keeps the prototype's size.
  const rawTitle: unknown = t.raw("hero.title");
  const em = typeof rawTitle === "string" ? headlineFit(rawTitle) : { line: 0.01, unit: 0.01 };
  const fit = { "--h1-em": em.line, "--h1-unit": em.unit } as CSSProperties;

  const cards: PileCardData[] = (["jana", "petr", "alex"] as const).map((key) => ({
    key,
    name: SAMPLE[key].name,
    role: t(`pile.${key}.role`),
    verdict: t(`pile.${key}.verdict`),
    score: SAMPLE[key].score,
    tone: SAMPLE[key].tone
  }));

  return (
    <HeroShell
      labelledBy="h1"
      live={{ on: ts("hero.liveOn"), off: ts("hero.liveOff"), signed: ts("hero.liveSigned", { name: SIGNER }) }}
    >
      <HeroSky />

      <div className="stage" id="stage">
        <div className="left">
          <p className="eyebrow">
            <SparkGlyph />
            {t("hero.badge")}
          </p>

          <h1 className="h1" id="h1" style={fit}>
            <span className="l1">{line1}</span>
            <span className="l2">{line2}</span>
          </h1>

          <p className="lede">{ts("hero.lede")}</p>
          <p className="oss">
            {t("hero.proof")}{" "}
            <TrackedLink href="#pricing" placement="hero_proof">
              {t("hero.proofCta")} <span aria-hidden="true">{GLYPH.next}</span>
            </TrackedLink>
          </p>

          <div className="ctas">
            <StartCta signupOpen={signupOpen} placement="hero" className="btn btn-lg primary" arrow />
            <DemoCta className="btn btn-lg" play />
          </div>
        </div>

        <div className="art-wrap">
          <i className="fleck fl1" aria-hidden="true" />
          <i className="fleck fl2" aria-hidden="true" />
          <i className="fleck fl3" aria-hidden="true" />
          <i className="fleck fl4" aria-hidden="true" />
          <HeroSun />
          {/* The page's largest paint, as today: the 920px WebP master
              (public/landing/spark-mascot.webp), priority, with `sizes` declaring
              the drawn width so the optimiser's srcset can go smaller. */}
          <Image
            className="kandi"
            id="kandi"
            src="/landing/spark-mascot.webp"
            width={920}
            height={920}
            sizes={KANDI_SIZES}
            priority
            alt={t("hero.mascotAlt")}
          />
        </div>

        <div className="note-col">
          <p className="pile-note" id="autoNote">
            <span className="n-off">{ts("hero.noteOff")}</span>
            <span className="n-on">{ts("hero.noteOn")}</span>
            <small>{ts("hero.noteSample")}</small>
          </p>
          {/* Opens the scoring scene of the features band: its deep link. */}
          <a className="btn btn-sm score-link" href="#spotlight-score">
            {ts("hero.scoreLink", { name: SAMPLE.jana.first, score: SAMPLE.jana.score })}{" "}
            <span aria-hidden="true">{GLYPH.next}</span>
          </a>
        </div>

        <HeroPile
          label={ts("hero.pileLabel")}
          cards={cards}
          waiting={t("trust.art.human.waiting")}
          signLabel={ts("hero.signPass")}
          signedLabel={t("trust.art.human.signed", { name: SIGNER })}
        />
      </div>
    </HeroShell>
  );
}
