import { getTranslations } from "next-intl/server";
import { Edge } from "./art/Edge";
import { SAMPLE, SIGNER } from "./art/samples";
import { GateTrack, Unattended } from "./HumanGate";

/*
 * The human-gate band (prototype `.sec.human#human`): "Powerful AI. A human signs
 * every call." on moss, then two demonstrations side by side (the gate rail and
 * the "what may run unattended" switches, HumanGate.tsx), the human-in-the-loop
 * paragraph, the four compliance pillars as chips and the legal line.
 *
 * Copy of record is today's `landing.trust.*`. `trust.human.body` carries the
 * "by default" qualifier MarketingClaims.test.ts requires in every locale (the
 * screening and offer gates can be delegated, a rejection cannot), and the
 * switches show exactly that rule. New lines (gate messages, legend, log) are
 * `siteLand.human.*`.
 */
const PILLARS = ["human", "oversight", "gdpr", "audit"] as const;

export default async function Human() {
  const t = await getTranslations("landing");
  const ts = await getTranslations("siteLand");
  const name = SAMPLE.jana.name;
  const gates = {
    screen: t("trust.art.human.gates.screen"),
    offer: t("trust.art.human.gates.offer"),
    reject: t("trust.art.human.gates.reject")
  };

  return (
    <section className="sec human" id="human" aria-labelledby="humanH">
      <Edge d="M0 60V22Q240 -4 480 24T960 16T1280 28T1600 12V60Z" />
      <div className="wrap">
        <div className="sec-h split wide-l">
          <h2 id="humanH">{t.rich("trust.heading", { br: () => <br />, emph: (chunks) => <span>{chunks}</span> })}</h2>
          <p className="lead">{t("trust.subtitle")}</p>
        </div>

        <div className="hg">
          <GateTrack
            stations={[
              t("trust.art.human.stations.intake"),
              t("trust.art.human.stations.score"),
              t("trust.art.human.stations.gate"),
              t("trust.art.human.stations.hired")
            ]}
            fit={t("trust.art.human.score", { fit: SAMPLE.jana.score })}
            evidence={ts("human.evidence")}
            waiting={t("trust.art.human.waiting")}
            signed={t("trust.art.human.signed", { name: SIGNER })}
            initials={SAMPLE.jana.initials}
            messages={{
              approaching: ts("human.gate.approaching", { name }),
              arrives: ts("human.gate.arrives", { name }),
              scored: ts("human.gate.scored", { fit: SAMPLE.jana.score }),
              waiting: ts("human.gate.waiting", { name }),
              signed: ts("human.gate.signed", { signer: SIGNER })
            }}
            signLabel={ts("human.signAs", { name: SIGNER })}
            replayLabel={ts("human.replay")}
          />
          <Unattended
            title={t("trust.art.human.allowTitle")}
            names={gates}
            auto={t("trust.art.human.auto")}
            you={t("trust.art.human.you")}
            lockedNote={t("trust.art.human.lockedNote")}
            legendLocked={ts("human.legendLocked")}
            legendDelegable={ts("human.legendDelegable")}
            log={{
              none: ts("human.logNone"),
              screen: ts("human.logOne", { stage: gates.screen }),
              offer: ts("human.logOne", { stage: gates.offer }),
              both: ts("human.logTwo", { first: gates.screen, second: gates.offer })
            }}
          />
        </div>

        <div className="hb">
          <div className="hitl">
            <h3 className="eyebrow-s">{t("trust.human.title")}</h3>
            <p>{t("trust.human.body")}</p>
          </div>
          <div className="hb-r">
            <ul className="chips2">
              {PILLARS.map((key) => (
                <li key={key}>{t(`trust.${key}.title`)}</li>
              ))}
            </ul>
            <p className="legal">{t("trust.footnote")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
