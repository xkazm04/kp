import { Fragment, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { DioProps } from "./dio";
import type { Grad, Stop } from "./assignment-geom";
import {
  COIL,
  HERO_GRADS,
  SCORES,
  SCORE_BAR_W,
  SCORE_MAX,
  WAVES,
  WAVE_BARS,
  sparkPath,
  zigzag,
} from "./interview-geom";

/*
 * Step 06 · Interview. A port of the prototype's about-art/s6-interview.js: a
 * live first-round screen (REC dot, running clock, a breathing waveform, the
 * interviewer's question, the candidate's answer typing in word by word, a
 * scorecard ticket that prints on hang-up); the hero is a pair of clay
 * headphones with soundwave arcs and a curled cable. All motion is CSS
 * (about-s6-interview.css), started by `.dio.is-in`, which the page controller
 * toggles on the root; the root's className stays constant.
 */

/** Gradient ids: one Interview drawing per page. */
const P = "dio-interview-";
const id = (k: string) => P + k;
const u = (k: string) => "url(#" + id(k) + ")";

function Stops({ list }: { list: readonly Stop[] }) {
  return (
    <>
      {list.map(([offset, cls]) => (
        <stop key={offset} offset={offset} className={cls} />
      ))}
    </>
  );
}

function Gradient({ g, gid }: { g: Grad; gid: string }) {
  return g.kind === "lin" ? (
    <linearGradient id={gid} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
      <Stops list={g.stops} />
    </linearGradient>
  ) : (
    <radialGradient id={gid} cx={g.cx} cy={g.cy} r={g.r}>
      <Stops list={g.stops} />
    </radialGradient>
  );
}

/* ---------------------------------------------------------------------------------------------------------
   HERO: clay headphones. viewBox 0 0 250 250 (symmetric, so side r just mirrors it in css). */

/* one ear cup, drawn for the LEFT side at x = 6..76; the right cup is the same drawing mirrored around x = 125 */
function Cup({ cls }: { cls: string }) {
  return (
    <g className={cls}>
      {/* cushion peeking out on the inner side */}
      <rect x="60" y="140" width="26" height="76" rx="13" fill={u("pad")} className="s-ink" strokeWidth="4.4" />
      <path className="s-ink" fill="none" strokeWidth="2.4" opacity=".28" d="M76 152V204" />
      {/* the shell */}
      <rect x="6" y="122" width="70" height="98" rx="30" fill={u("cup")} className="s-ink" strokeWidth="5" />
      <path className="f-shade" d="M76 160C76 196 66 214 44 219C64 222 76 208 76 176Z" />
      <rect x="15" y="131" width="52" height="80" rx="23" fill="none" className="s-ink" strokeWidth="2.6" opacity=".2" />
      <path className="s-hi" fill="none" strokeWidth="6" strokeLinecap="round" opacity=".55" d="M16 160C16 146 24 137 36 134" />
      <path className="s-hi" fill="none" strokeWidth="3" strokeLinecap="round" opacity=".5" d="M17 172V182" />
      {/* brass plate */}
      <circle cx="41" cy="171" r="19" fill={u("plate")} className="s-ink" strokeWidth="4" />
      <circle cx="41" cy="171" r="11" fill="none" className="s-ink" strokeWidth="2.4" opacity=".35" />
      <circle cx="41" cy="171" r="4.4" className="f-ink" opacity=".75" />
      <path className="s-white" fill="none" strokeWidth="2.6" strokeLinecap="round" opacity=".7" d="M28 162C31 155 37 153 43 153" />
    </g>
  );
}

const BAND = "M41 134C34 22 216 22 209 134";
const BAND_PAD = "M83 66C104 56 146 56 167 66";

function HeroSvg() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="iv-hero-svg"
      viewBox="0 0 250 250"
      aria-hidden="true"
      focusable="false"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <defs>
        {HERO_GRADS.map((g) => (
          <Gradient key={g.key} g={g} gid={id(g.key)} />
        ))}
      </defs>
      <g className="k-card">
        <g className="k-float">
          {/* curled cable from the outer cup down to a jack plug */}
          <g className="k-cable">
            <path d={COIL} fill="none" className="s-ink" strokeWidth="13" strokeLinecap="round" />
            <path d={COIL} fill="none" stroke={u("cable")} strokeWidth="7" strokeLinecap="round" />
            <path d="M45 224C46 236 58 241 70 238" fill="none" className="s-white" strokeWidth="2" strokeLinecap="round" opacity=".8" />
            <g transform="translate(116 222) rotate(-32)">
              <rect x="-4" y="-8" width="30" height="16" rx="6" fill={u("plug")} className="s-ink" strokeWidth="4" />
              <path className="s-white" fill="none" strokeWidth="2" strokeLinecap="round" opacity=".8" d="M2 -3.6H16" />
              <rect x="24" y="-4.4" width="14" height="8.8" rx="3.2" className="f-sil s-ink" strokeWidth="3.2" />
            </g>
          </g>
          <Cup cls="k-cupL" />
          <g transform="translate(250 0) scale(-1 1)">
            <Cup cls="k-cupR" />
          </g>
          <path d={BAND} fill="none" className="s-ink" strokeWidth="31" strokeLinecap="round" />
          <path d={BAND} fill="none" stroke={u("band")} strokeWidth="21" strokeLinecap="round" />
          <path d="M47 112C47 62 88 43 132 42" fill="none" className="s-white" strokeWidth="4.4" strokeLinecap="round" opacity=".55" />
          {/* the cushioned underside of the band */}
          <path d={BAND_PAD} fill="none" className="s-ink" strokeWidth="9" strokeLinecap="round" opacity=".9" />
          <path d={BAND_PAD} fill="none" className="s-pad" strokeWidth="5" strokeLinecap="round" />
          {/* yokes */}
          <rect x="27" y="118" width="26" height="24" rx="8" fill={u("plate")} className="s-ink" strokeWidth="3.6" />
          <rect x="197" y="118" width="26" height="24" rx="8" fill={u("plate")} className="s-ink" strokeWidth="3.6" />
          <path className="s-white" fill="none" strokeWidth="2.4" strokeLinecap="round" opacity=".7" d="M32 125H41M202 125H211" />
          {/* soundwaves around the inner (right) cup: they pulse outwards */}
          <g className="k-waves">
            {WAVES.map(([cls, d, sw]) => (
              <path key={cls} className={cls} d={d} fill="none" strokeWidth={sw} strokeLinecap="round" />
            ))}
          </g>
        </g>
        <g className="k-sp">
          <g className="k-sp1">
            <path className="f-spark" d={sparkPath(14, 54, 11)} />
          </g>
          <g className="k-sp2">
            <path className="f-spark2" d={sparkPath(240, 108, 6.5)} />
          </g>
          <g className="k-sp3">
            <path className="f-spark2" d={sparkPath(150, 14, 5)} />
          </g>
        </g>
      </g>
    </svg>
  );
}

/* ---------------------------------------------------------------------------------------------------------
   THE SCREEN */

const HEADSET_ARC = "M7 19V16A9 9 0 0 1 25 16V19";

function HeadsetGlyph() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" strokeLinecap="round" strokeLinejoin="round">
      <path d={HEADSET_ARC} fill="none" className="s-ink" strokeWidth="3.6" />
      <path d={HEADSET_ARC} fill="none" stroke="#cbdde5" strokeWidth="1.6" />
      <rect x="3.6" y="16.6" width="6.4" height="10" rx="3" className="f-coral s-ink" strokeWidth="2.2" />
      <rect x="22" y="16.6" width="6.4" height="10" rx="3" className="f-coral s-ink" strokeWidth="2.2" />
    </svg>
  );
}

function PersonGlyph() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.6 30C5.6 22 10 19 16 19S26.4 22 26.4 30Z" className="f-steel s-ink" strokeWidth="2.4" />
      <circle cx="16" cy="12" r="6" className="f-cream s-ink" strokeWidth="2.4" />
      <path d="M12.6 10.4Q14 8.4 17 8.6" fill="none" className="s-white" strokeWidth="1.6" opacity=".8" />
    </svg>
  );
}

/** A sentence as word spans (`--k` = index) joined by spaces, so the CSS can type it in word by word. */
function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(" ").map((w, i) => (
        <Fragment key={i}>
          {i ? " " : null}
          <span className="w" style={{ "--k": i } as CSSProperties}>
            {w}
          </span>
        </Fragment>
      ))}
    </>
  );
}

export default function InterviewArt({ side, vars }: DioProps) {
  const t = useTranslations("aboutPage.art.interview");
  const ts = useTranslations("siteAbout.art.interview");

  return (
    <div className="dio dio-interview" data-side={side} style={vars}>
      <div className="bz">
        <div className="gl">
          <div className="iv-win">
            <header className="iv-bar">
              <span className="iv-rec" aria-hidden="true" />
              <p className="iv-title">{t("screenTitle")}</p>
              <p className="iv-live">
                <span className="iv-bars" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                {t("meta")}
              </p>
            </header>
            <div className="iv-wave" aria-hidden="true">
              {WAVE_BARS.map((b, i) => (
                <i key={i} style={{ "--h": b.h, "--h2": b.h2, "--i": i } as CSSProperties} />
              ))}
            </div>
            <div className="iv-chat">
              <div className="iv-turn is-q">
                <span className="iv-av" aria-hidden="true">
                  <HeadsetGlyph />
                </span>
                <div className="iv-col">
                  <span className="sil">{ts("interviewer")}</span>
                  <p className="iv-bub">
                    <Words text={t("askAi")} />
                  </p>
                </div>
              </div>
              <div className="iv-turn is-a">
                <div className="iv-col">
                  <span className="sil">{ts("candidate")}</span>
                  <p className="iv-bub">
                    <span className="iv-dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <Words text={t("replyThem")} />
                  </p>
                </div>
                <span className="iv-av" aria-hidden="true">
                  <PersonGlyph />
                </span>
              </div>
            </div>
            <div className="iv-print">
              <div className="iv-mouth" aria-hidden="true">
                <span className="iv-slot" />
                <i className="iv-pled" />
              </div>
              <div className="iv-clip">
                <div className="iv-ticket" style={{ clipPath: zigzag() }}>
                  <p className="iv-tt">{t("scorecard")}</p>
                  <ul className="iv-scs" aria-hidden="true">
                    {SCORES.map((score, r) => (
                      <li key={r} className="iv-sc" style={{ "--r": r } as CSSProperties}>
                        <b style={{ "--w": SCORE_BAR_W[r] + "%" } as CSSProperties} />
                        <span className="iv-ds" role="img" aria-label={ts("scoreOf", { score, max: SCORE_MAX })}>
                          {Array.from({ length: SCORE_MAX }, (_, j) => (
                            <i key={j} className={j < score ? "on" : undefined} />
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="dio-hero dio-hero--a" aria-hidden="true">
        <HeroSvg />
      </div>
    </div>
  );
}
