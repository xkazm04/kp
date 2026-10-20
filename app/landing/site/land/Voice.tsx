import { getTranslations } from "next-intl/server";
import { Edge } from "./art/Edge";
import { VoicePlayer } from "./VoicePlayer";

/*
 * The voice band (prototype `.sec.voice#voice`): cream ground with a coral glow,
 * "It doesn't just read CVs. It talks to people.", the pitch, three checks, and a
 * stylised call card with a sample transcript that replays on demand. All copy is
 * today's `landing.voice.*`; only the card's caption is new (`siteLand.voice`).
 */
export default async function Voice() {
  const t = await getTranslations("landing");
  const ts = await getTranslations("siteLand");
  return (
    <section className="sec voice" id="voice" aria-labelledby="voiceH">
      <Edge d="M0 60V18Q260 44 520 22T1040 26T1600 10V60Z" />
      <div className="wrap two">
        <VoicePlayer
          heading={t.rich("voice.heading", { br: () => <br />, emph: (chunks) => <em>{chunks}</em> })}
          lead={t("voice.body")}
          previewLabel={t("voice.previewCta")}
          bullets={t.raw("voice.bullets") as string[]}
          cardTitle={t("voice.cardTitle")}
          cardMeta={t("voice.cardMeta")}
          transcript={t.raw("voice.transcript") as string[]}
          caption={ts("voice.caption")}
        />
      </div>
    </section>
  );
}
