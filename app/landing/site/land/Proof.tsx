import { getTranslations } from "next-intl/server";
import { PLATE_BG, ProofArt, type ProofArtKey } from "./art/ProofArt";
import { ProofStack, type ProofPillar } from "./ProofStack";
import { Edge } from "./art/Edge";

/*
 * The proof band (prototype `.sec.proof#proof`, A/1's section re-inked in the
 * landing's tokens): the torn steel-blue edge, the hand-written hint, the
 * two-colour headline, the lede, then three pillars that scroll past a sticky
 * stack of three stylised plates (ProofStack). Copy of record is today's
 * `landing.proof.*` (hint = footline, pillars = cards.*); the pillar labels and
 * plate captions are the prototype's (`siteLand.proof.*`).
 */
const PILLARS = ["samples", "defend", "sealed"] as const satisfies readonly ProofArtKey[];

export default async function Proof() {
  const t = await getTranslations("landing");
  const ts = await getTranslations("siteLand");
  const signedBy = ts("proof.signedBy");

  const pillars: ProofPillar[] = PILLARS.map((key) => ({
    key,
    label: ts(`proof.pillars.${key}.label`),
    caption: ts(`proof.pillars.${key}.caption`),
    title: t(`proof.cards.${key}.title`),
    body: t(`proof.cards.${key}.body`),
    art: <ProofArt art={key} signedBy={signedBy} />,
    plateBg: PLATE_BG[key]
  }));

  return (
    <section className="sec proof" id="proof" aria-labelledby="proofH">
      <Edge d="M0 60V32Q160 4 360 26T760 20T1160 30T1600 14V60Z" />
      <div className="wrap proof-grid">
        <ProofStack
          intro={
            <>
              <p className="hand sec-hint">{t("proof.footline")}</p>
              <h2 id="proofH">
                {t.rich("proof.heading", { br: () => <br />, emph: (chunks) => <span>{chunks}</span> })}
              </h2>
              <p className="lead pf-lede">{t("proof.subtitle")}</p>
            </>
          }
          pillars={pillars}
          stylised={ts("proof.stylised")}
          stageLabel={ts("proof.stageLabel")}
        />
      </div>
    </section>
  );
}
