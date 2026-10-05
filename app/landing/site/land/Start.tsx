import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { DemoCta, StartCta } from "../chrome/Ctas";
import { Edge } from "./art/Edge";

/*
 * The closing band (prototype `.sec.start#start`): "Your next great hire is
 * buried in that pile.", the two calls to action (the chrome's StartCta, labelled
 * "Get started" as today's closing button, and DemoCta), the hand-written promise,
 * and Kandi bobbing over a pile of papers. Copy is today's `landing.cta.*`.
 */
export type StartProps = { signupOpen: boolean };

export default async function Start({ signupOpen }: StartProps) {
  const t = await getTranslations("landing");
  return (
    <section className="sec start" id="start" aria-labelledby="startH">
      <Edge d="M0 60V26Q260 -2 520 22T1000 20T1300 30T1600 8V60Z" />
      <div className="wrap">
        <div className="start-copy">
          <h2 id="startH">{t.rich("cta.heading", { br: () => <br /> })}</h2>
          <p className="lead">{t("cta.body")}</p>
          <div className="ctas">
            <StartCta signupOpen={signupOpen} placement="closing" className="btn btn-lg primary" arrow>
              {t("cta.button")}
            </StartCta>
            <DemoCta className="btn btn-lg" play />
          </div>
          <p className="hand">{t("cta.note")}</p>
        </div>
        <div className="dig" aria-hidden="true">
          <Image
            src="/landing/spark-mascot.webp"
            alt=""
            width={920}
            height={920}
            sizes="(max-width: 1099px) 300px, 32vw"
          />
          <span className="pl p1" />
          <span className="pl p2" />
          <span className="pl p3" />
          <span className="pl p4" />
          <span className="pl p5" />
        </div>
      </div>
    </section>
  );
}
