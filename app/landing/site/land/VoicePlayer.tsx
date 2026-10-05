"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { GLYPH } from "../chrome/glyphs";

/*
 * The voice band's two columns (prototype `.voice .wrap.two` + app.js "voice
 * preview"): the pitch with its "Preview voice screening" button, and the call
 * card whose sample transcript plays back bubble by bubble when the button is
 * pressed (1.5 s apart; at once under reduced motion). The transcript starts
 * fully shown, as the prototype's did after start-up.
 */

const WHO = ["m-q", "m-a", "m-q"] as const;
const REDUCE = "(prefers-reduced-motion: reduce)";

/* The prototype broke its headline by hand ("It doesn't just / read CVs. / It
 * talks to people."); the catalog's translated heading has one <br> fewer, and a
 * balanced wrap puts the break where the prototype had it. */
const BALANCED: CSSProperties = { textWrap: "balance" };

export function VoicePlayer({
  heading,
  lead,
  previewLabel,
  bullets,
  cardTitle,
  cardMeta,
  transcript,
  caption
}: {
  heading: ReactNode;
  lead: string;
  previewLabel: string;
  bullets: readonly string[];
  cardTitle: string;
  cardMeta: string;
  transcript: readonly string[];
  caption: string;
}) {
  const [shown, setShown] = useState(transcript.length);
  const timers = useRef<number[]>([]);

  const clear = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };
  useEffect(() => clear, []);

  const play = () => {
    clear();
    setShown(0);
    const reduced = window.matchMedia(REDUCE).matches;
    transcript.forEach((_, i) => {
      timers.current.push(window.setTimeout(() => setShown(i + 1), reduced ? 0 : 350 + i * 1500));
    });
  };

  return (
    <>
      <div className="voice-copy">
        <h2 id="voiceH" style={BALANCED}>
          {heading}
        </h2>
        <p className="lead">{lead}</p>
        <button className="btn" type="button" onClick={play}>
          {previewLabel} <span aria-hidden="true">{GLYPH.play}</span>
        </button>
        <ul className="checks">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </div>
      <div className="voice-card">
        <div className="vc-h">
          <span className="rec" aria-hidden="true" />
          <div>
            <b>{cardTitle}</b>
            <small>{cardMeta}</small>
          </div>
          <span className="eq" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>
        <div className="vc-log" aria-live="polite">
          {transcript.map((line, i) => (
            <p key={i} className={i < shown ? `${WHO[i % WHO.length]} shown` : WHO[i % WHO.length]}>
              {line}
            </p>
          ))}
        </div>
        <p className="m-cap">{caption}</p>
      </div>
    </>
  );
}
