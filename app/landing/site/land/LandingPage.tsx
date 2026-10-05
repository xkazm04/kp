import { getTranslations } from "next-intl/server";
import Hero from "./Hero";
import Marquee from "./Marquee";
import Proof from "./Proof";
import Features from "./features/Features";
import Voice from "./Voice";
import Human from "./Human";
import Pricing from "./Pricing";
import Enterprise from "./Enterprise";
import Start from "./Start";
import { SAMPLE } from "./art/samples";
import { LandingMotion, type SpineSection } from "./LandingMotion";

/*
 * The landing's composition, in the prototype's order (index.html). The route
 * shell (app/landing/spark/SparkHome.tsx) wraps it in MkRoot with the shared
 * Header, Footer and CtaDock and imports ./styles first.
 *
 * The page-level pieces that are not a band live in LandingMotion: the `.spine`
 * position rail (rendered before <main>, as in the prototype), the header nav's
 * scroll-spy and the reveals. Its eight stops are the bands, each with the stage
 * Jana's card has reached when the band is in view.
 */
export default async function LandingPage({ signupOpen }: { signupOpen: boolean }) {
  const t = await getTranslations("landing");
  const tc = await getTranslations("siteChrome");
  const ts = await getTranslations("siteLand");

  const sections: SpineSection[] = [
    { id: "top", label: ts("spine.sections.top"), stage: t("trust.art.human.stations.intake") },
    { id: "proof", label: t("nav.proof"), stage: ts("spine.stages.scored", { score: SAMPLE.jana.score }) },
    { id: "features", label: t("nav.features"), stage: ts("spine.stages.routed") },
    { id: "voice", label: tc("nav.voice"), stage: ts("spine.stages.voice") },
    { id: "human", label: tc("nav.human"), stage: ts("spine.stages.gate") },
    { id: "pricing", label: t("nav.pricing"), stage: ts("spine.stages.signed") },
    { id: "enterprise", label: ts("spine.sections.enterprise"), stage: ts("spine.stages.sealed") },
    { id: "start", label: ts("spine.sections.start"), stage: ts("spine.stages.hired") }
  ];

  return (
    <>
      <LandingMotion
        label={ts("spine.label")}
        sampleName={SAMPLE.jana.name}
        initials={SAMPLE.jana.initials}
        sections={sections}
      />
      <main id="main">
        <Hero signupOpen={signupOpen} />
        <Marquee />
        <Proof />
        <Features signupOpen={signupOpen} />
        <Voice />
        <Human />
        <Pricing signupOpen={signupOpen} />
        <Enterprise />
        <Start signupOpen={signupOpen} />
      </main>
    </>
  );
}
