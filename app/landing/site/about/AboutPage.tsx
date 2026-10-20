import type { ComponentType, CSSProperties, ReactNode } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { DemoCta, StartCta } from "../chrome/Ctas";
import { aboutStepId } from "../../spark/about-art/shared";
import { taggedTexts, widestEm } from "../land/headlineFit";
import AboutLine from "./AboutLine";
import { CueLink, Dust, GateButton, HeroMap, ReplayButton, StepNode, TapeUnit } from "./parts";
import { NoteArrow, SealArt } from "./icons";
import { NOTE_POS, STEP_KEYS, STEP_PAINT, STEP_SCOPED, pad2, type StepKey } from "./steps";
import type { DioProps, DioVars } from "./art/dio";
import DesignArt from "./art/DesignArt";
import SourceArt from "./art/SourceArt";
import IntakeArt from "./art/IntakeArt";
import ScreenArt from "./art/ScreenArt";
import AssignmentArt from "./art/AssignmentArt";
import InterviewArt from "./art/InterviewArt";
import OfferArt from "./art/OfferArt";
import HiredArt from "./art/HiredArt";

/*
 * /about: THE LINE (the fused prototype's about.html). One hire walked down the whole pipeline: the hero (the route as
 * one LCD, Kandi, where the ribbon starts), eight step chapters (copy, a human gate, a drawing with its handwritten note,
 * a node on the ribbon), and the finale (the seal where the ribbon ends, the receipts tape the gates feed, two CTAs).
 * Server-rendered: every word and drawing is in the HTML; <AboutLine> (client) adds the ribbon, the gates, the stepper
 * and the choreography around it. Step anchors are aboutStepId(i) (#step-01..#step-08): the JSON-LD HowTo, the phone
 * menu and shared links point at them. The header, footer and phone dock are the route shell's (spark/AboutHome.tsx).
 */
export type AboutPageProps = { signupOpen: boolean };

const ART: Record<StepKey, ComponentType<DioProps>> = {
  design: DesignArt,
  source: SourceArt,
  intake: IntakeArt,
  screen: ScreenArt,
  assignment: AssignmentArt,
  interview: InterviewArt,
  offer: OfferArt,
  hired: HiredArt
};

/** Kandi, the clay mascot (public/landing/spark-mascot.webp, cropped by .kandi-fig). */
function Kandi({ id, className, alt, eager = false }: { id: string; className: string; alt: string; eager?: boolean }) {
  return (
    <div className={`${className} kandi`} id={id} data-mood="idle">
      <div className="kandi-fig">
        <Image
          src="/landing/spark-mascot.webp"
          alt={alt}
          width={447}
          height={449}
          sizes="480px"
          decoding="async"
          loading={eager ? "eager" : "lazy"}
        />
      </div>
      <i className="kandi-shadow" aria-hidden="true" />
    </div>
  );
}

/** The landing. A plain <a>, never next/link: each page loads its own stylesheet list (site/README.md). */
const HOME_HREF = "/";

const lines = {
  line: (chunks: ReactNode) => <span>{chunks}</span>,
  em: (chunks: ReactNode) => <em>{chunks}</em>
};

export default function AboutPage({ signupOpen }: AboutPageProps) {
  const t = useTranslations("siteAbout");
  const ta = useTranslations("aboutPage");
  const tl = useTranslations("landing");
  // The poster title's widest line in em (-.04em tracking): on a phone every line is set so it clears the edge.
  const heroRaw: unknown = t.raw("hero.title");
  const heroFit = {
    "--hh-em": typeof heroRaw === "string" ? widestEm(taggedTexts(heroRaw, "line"), -0.04) : 0.01
  } as CSSProperties;

  const noscript = (
    <noscript>
      <p className="noscript">{t.rich("noscript", { link: (chunks) => <a href={HOME_HREF}>{chunks}</a> })}</p>
    </noscript>
  );

  return (
    <>
      {/* studio backdrop: wall, a tint that follows the step in view, warm cone, pool of light, dust, grain, vignette */}
      <div className="studio" aria-hidden="true">
        <i className="wall" />
        <i className="tint" />
        <i className="cone" />
        <i className="pool" />
        <Dust />
        <i className="grain" />
        <i className="vig" />
      </div>

      <AboutLine lead={noscript}>
        {/* HERO: the overview level. The poster, the line's route as one LCD, Kandi, and where the ribbon begins. */}
        <section className="hero" id="top" aria-labelledby="h1">
          <div className="frame">
            <p className="hero-eyebrow sil" id="heroEyebrow">
              {ta("hero.badge")}
            </p>
            <h1 className="hero-h" id="h1" style={heroFit}>
              {t.rich("hero.title", lines)}
            </h1>
            <p className="hero-lead" id="heroLead">
              {ta("hero.subtitle")}
            </p>
            <div className="hero-ctas">
              <StartCta signupOpen={signupOpen} placement="about-hero" className="btn btn-lg primary" arrow />
              <DemoCta className="btn btn-lg" play />
            </div>
            <p className="hero-cue" id="heroCue">
              <CueLink href={`#${aboutStepId(0)}`}>
                <span className="cue-ic" aria-hidden="true">
                  <i />
                </span>
                <span>{t("hero.cue")}</span>
              </CueLink>
            </p>
            <Kandi id="kandi" className="hero-kandi" alt={t("hero.mascotAlt")} eager />
            <HeroMap />
          </div>
        </section>

        {/* THE LINE: eight steps */}
        <div id="line">
          {STEP_KEYS.map((key, i) => {
            const side = i % 2 === 0 ? "l" : "r";
            const n2 = pad2(i + 1);
            const paint = STEP_PAINT[key];
            const vars: DioVars = { "--sc": paint.color, "--sc-hi": paint.hi, "--sc-ink": paint.ink };
            const [nx, ny, nr] = NOTE_POS[i];
            const Art = ART[key];
            return (
              <section
                key={key}
                className="step"
                id={aboutStepId(i)}
                data-side={side}
                data-i={i}
                aria-labelledby={`t-${n2}`}
                style={vars}
              >
                <div className="frame">
                  <div className="txt">
                    <span className="num" aria-hidden="true">
                      {n2}
                    </span>
                    <p className="eyebrow hand" style={{ "--i": 0 } as CSSProperties}>
                      {ta(`steps.${key}.eyebrow`)}
                      {STEP_SCOPED.has(key) ? (
                        <>
                          {" "}
                          <span className="scope">{t("scope.assignment")}</span>
                        </>
                      ) : null}
                    </p>
                    <h2 className="title" id={`t-${n2}`} style={{ "--i": 1 } as CSSProperties}>
                      {ta(`steps.${key}.title`)}
                    </h2>
                    <p className="body" style={{ "--i": 2 } as CSSProperties}>
                      {ta(`steps.${key}.body`)}
                    </p>
                    <GateButton i={i} />
                  </div>
                  <div className="art">
                    <Art side={side} vars={vars} />
                    <p
                      className="hand hand-note"
                      style={{ "--nx": `${nx}%`, "--ny": `${ny}%`, "--nr": `${nr}deg` } as CSSProperties}
                    >
                      {t(`notes.${key}`)}
                      <NoteArrow />
                    </p>
                    <div className="art-foot">
                      <span className="sample-cap sil">{t("sampleCaption")}</span>
                      <ReplayButton i={i} />
                    </div>
                  </div>
                  <StepNode i={i} />
                </div>
              </section>
            );
          })}
        </div>

        {/* CLOSING: the seal where the ribbon ends, the headline, two calls to action, the receipts tape, Kandi */}
        <section className="closing" id="end" aria-labelledby="endTitle">
          <div className="frame">
            <span className="seal" id="jackEnd" aria-hidden="true">
              <SealArt />
            </span>
            <div className="end-copy">
              <p className="sil end-tag" id="endTag">
                {ta("closing.tag")}
              </p>
              <h2 className="end-h" id="endTitle">
                {t.rich("closing.title", lines)}
              </h2>
              <p className="end-body" id="endBody">
                {ta("closing.body")}
              </p>
              <div className="end-ctas">
                <StartCta signupOpen={signupOpen} placement="about-end" className="btn btn-lg primary" arrow>
                  <span id="endBtn">{ta("closing.button")}</span>
                </StartCta>
                <DemoCta className="btn btn-lg" play />
              </div>
              <p className="end-legal">{t("closing.samples")}</p>
              <p className="legal">{tl("trust.footnote")}</p>
            </div>
            <div className="end-unit" id="endUnit">
              <TapeUnit />
              <p className="sample-cap sil">{t("sampleCaption")}</p>
            </div>
            <Kandi id="kandi2" className="end-kandi" alt={tl("hero.mascotAlt")} />
          </div>
        </section>
      </AboutLine>
    </>
  );
}
