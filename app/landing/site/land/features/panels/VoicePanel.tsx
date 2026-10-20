"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Chip, Dots, PauseButton, vars } from "./kit";

/*
 * Voice screening (B/3 `voice`, prototype land/mocks.js §2): a live first-round
 * call, its waveform, the first three turns and the scorecard; "Look closer"
 * shows the whole conversation and the scorecard with a note per criterion.
 * Pause freezes the waveform and the recording dot (CSS on `.is-paused`).
 */
type Turn = { who: "q" | "a"; key: "q1" | "a1" | "q2" | "a2" | "q3" | "a3" | "q4" | "a4" };

const TURNS: readonly Turn[] = [
  { who: "q", key: "q1" },
  { who: "a", key: "a1" },
  { who: "q", key: "q2" },
  { who: "a", key: "a2" },
  { who: "q", key: "q3" },
  { who: "a", key: "a3" },
  { who: "q", key: "q4" },
  { who: "a", key: "a4" }
];

const CRIT = [
  { key: "depth", dots: 4 },
  { key: "solving", dots: 3 },
  { key: "communication", dots: 4 },
  { key: "ownership", dots: 4 }
] as const;

/** Thirty bar heights: a fixed, speech-like shape (the prototype's formula). */
const WAVE = Array.from({ length: 30 }, (_, i) => {
  const h = 0.22 + 0.78 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.53));
  return Math.round(h * 100) / 100;
});

function Wave() {
  return (
    <div className="mk-wave" aria-hidden="true">
      {WAVE.map((h, i) => (
        <i key={i} style={vars({ "--h": h, "--i": i })} />
      ))}
    </div>
  );
}

export default function VoicePanel({ detail }: { detail: boolean }) {
  const t = useTranslations("siteFeatures");
  const tl = useTranslations("landing");
  const [paused, setPaused] = useState(false);
  const turns = detail ? TURNS : TURNS.slice(0, 3);
  const root = detail ? "mock mk-detail mk-voice-d" : "mock mk-voice";
  return (
    <div className={paused ? `${root} is-paused` : root}>
      <div className="mk-hd">
        <span className="mk-rec" aria-hidden="true" />
        <span className="mk-ttl">{tl("previews.voice.screenTitle")}</span>
        <span className="sil">{detail ? t("voice.transcript") : t("voice.live")}</span>
        <PauseButton paused={paused} onToggle={() => setPaused((p) => !p)} />
      </div>
      <Wave />
      <div className="mk-cols" style={vars(detail ? { "--c1": "1.6fr", "--c2": "1fr" } : { "--c1": "1.45fr", "--c2": "1fr" })}>
        <div className={detail ? "mk-turns mk-tx" : "mk-turns"}>
          {turns.map((turn) => (
            <div key={turn.key} className={`mk-turn is-${turn.who}`}>
              <span className="sil">{turn.who === "q" ? t("voice.interviewer") : t("voice.candidate")}</span>
              <p>{t(`voice.${turn.key}`)}</p>
            </div>
          ))}
        </div>
        <aside className="mk-panel mk-score">
          <span className="sil">{detail ? t("voice.scorecardFull") : t("voice.scorecard")}</span>
          <ul>
            {CRIT.map((c) => (
              <li key={c.key} className="mk-crit">
                <span>{t(`voice.crit.${c.key}`)}</span>
                <Dots n={c.dots} />
                {detail ? <em>{t(`voice.crit.${c.key}Note`)}</em> : null}
              </li>
            ))}
          </ul>
        </aside>
      </div>
      <div className="mk-chips">
        <Chip className="is-a">{t("voice.chipLanguages")}</Chip>
        {detail ? (
          <>
            <Chip>{t("voice.chipGrounded")}</Chip>
            <Chip>{t("voice.chipTranscript")}</Chip>
          </>
        ) : null}
      </div>
    </div>
  );
}
