/*
 * The four doors of the district (careers page, email intake, ad forms, pull feeds), drawn flat
 * and outlined. Pure presentation: every fill and stroke is a class (channelsNightScene.css maps
 * the classes onto theme tokens), and every state-dependent part is a `cn-on-*` group the
 * nearest `[data-cond]` ancestor shows or hides. Conventions: night/README.md "Art".
 */
import { ArtSvg } from "./ChannelsArtSvg";

export function ChannelsArtCareers() {
  return (
    <ArtSvg viewBox="0 0 240 190" name="careers">
      <ellipse cx="120" cy="178" rx="104" ry="8" className="cn-a-gnd" />
      <rect x="30" y="64" width="180" height="110" rx="7" className="cn-a-f cn-fc-cream" />
      <path d="M20 64 L34 30 H206 L220 64 Z" className="cn-a-f cn-fc-coral" />
      <path d="M62 30 L56 64 H76 L80 30Z M108 30 L106 64 H126 L126 30Z M154 30 L156 64 H176 L172 30Z" className="cn-a-st cn-fc-cream" />
      <path d="M20 64 q10 14 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0" className="cn-a-line" />
      <path d="M98 174 V114 A22 22 0 0 1 142 114 V174 Z" className="cn-a-f cn-fc-moss" />
      <g className="cn-on-live">
        <path d="M98 174 V114 A22 22 0 0 1 142 114 V174 Z" className="cn-a-f cn-fc-ink" />
        <path d="M98 174 V114 A22 22 0 0 1 112 94 L112 168 Z" className="cn-a-f cn-fc-moss" />
      </g>
      <circle cx="132" cy="146" r="3.6" className="cn-a-f cn-fc-amber cn-on-notlive" />
      <rect x="44" y="92" width="34" height="34" rx="6" className="cn-a-f cn-fc-sky" />
      <path d="M61 92 V126 M44 109 H78" className="cn-a-line" />
      <rect x="162" y="92" width="34" height="34" rx="6" className="cn-a-f cn-fc-sky" />
      <path d="M179 92 V126 M162 109 H196" className="cn-a-line" />
      <rect x="84" y="6" width="72" height="22" rx="7" className="cn-a-f cn-fc-paper" />
      <path d="M96 17 H132" className="cn-a-line" />
      <circle cx="144" cy="17" r="3" className="cn-a-f cn-fc-coral" />
      <g className="cn-on-live">
        <rect x="10" y="150" width="22" height="26" rx="3" className="cn-a-f cn-fc-paper" transform="rotate(-8 21 163)" />
        <rect x="14" y="146" width="22" height="26" rx="3" className="cn-a-f cn-fc-lime" transform="rotate(6 25 159)" />
      </g>
    </ArtSvg>
  );
}

export function ChannelsArtEmail() {
  return (
    <ArtSvg viewBox="0 0 240 190" name="email">
      <ellipse cx="120" cy="178" rx="70" ry="8" className="cn-a-gnd" />
      <path d="M84 168 V80 a36 36 0 0 1 72 0 V168 Z" className="cn-a-f cn-fc-coral" />
      <rect x="74" y="160" width="92" height="16" rx="5" className="cn-a-f cn-fc-steel" />
      <circle cx="120" cy="36" r="8" className="cn-a-f cn-fc-paper" />
      <rect x="96" y="76" width="48" height="12" rx="6" className="cn-a-f cn-fc-ink" />
      <g className="cn-on-live">
        <path d="M102 70 L120 84 L138 70 V52 H102 Z" className="cn-a-f cn-fc-paper" />
        <path d="M102 52 L120 66 L138 52" className="cn-a-line" />
      </g>
      <circle cx="120" cy="126" r="18" className="cn-a-f cn-fc-cream" />
      <circle cx="120" cy="126" r="7" className="cn-a-line" />
      <path d="M125 126 v5 a4.5 4.5 0 0 0 8 0 v-5 a14 14 0 1 0 -5 11" className="cn-a-line" />
      <rect x="100" y="146" width="40" height="6" rx="3" className="cn-a-f cn-fc-paper" />
    </ArtSvg>
  );
}

export function ChannelsArtAds() {
  return (
    <ArtSvg viewBox="0 0 240 190" name="ads">
      <ellipse cx="120" cy="180" rx="96" ry="7" className="cn-a-gnd" />
      <rect x="64" y="110" width="12" height="66" className="cn-a-f cn-fc-steel" />
      <rect x="164" y="110" width="12" height="66" className="cn-a-f cn-fc-steel" />
      <rect x="26" y="16" width="188" height="102" rx="11" className="cn-a-f cn-fc-paper" />
      <rect x="40" y="28" width="160" height="18" rx="7" className="cn-a-f cn-fc-coral" />
      <rect x="40" y="54" width="160" height="14" rx="6" className="cn-a-f cn-fc-cream" />
      <rect x="40" y="74" width="160" height="14" rx="6" className="cn-a-f cn-fc-cream" />
      <rect x="40" y="94" width="62" height="16" rx="7" className="cn-a-f cn-fc-amber" />
      <path d="M150 108 L162 94 L174 108" className="cn-a-line" />
      <path d="M76 126 H164 L138 156 V176 H102 V156 Z" className="cn-a-f cn-fc-lime" />
      <g className="cn-on-live">
        <rect x="108" y="116" width="24" height="16" rx="3" className="cn-a-f cn-fc-paper" />
        <path d="M113 122 H127 M113 127 H122" className="cn-a-line" />
      </g>
    </ArtSvg>
  );
}

// The feeds building's window grid: 3 rows x 4, the one opened window is where a pull lands.
const FEED_WINDOWS = [0, 1, 2].flatMap((r) => [0, 1, 2, 3].map((c) => ({ x: 56 + c * 39, y: 36 + r * 44, open: r === 1 && c === 2 })));

export function ChannelsArtFeeds() {
  return (
    <ArtSvg viewBox="0 0 240 190" name="feeds">
      <ellipse cx="124" cy="180" rx="96" ry="7" className="cn-a-gnd" />
      <rect x="44" y="24" width="168" height="146" rx="9" className="cn-a-f cn-fc-steel" />
      {FEED_WINDOWS.map((w) => (
        <g key={`${w.x}-${w.y}`}>
          <rect x={w.x} y={w.y} width="33" height="36" rx="5" className={`cn-a-f ${w.open ? "cn-fc-ink" : "cn-fc-cream"}`} />
          {w.open ? null : <circle cx={w.x + 26} cy={w.y + 18} r="2.6" className="cn-a-f cn-fc-amber" />}
        </g>
      ))}
      <path d="M4 62 C30 50 54 96 96 88 S132 98 134 90" className="cn-a-line" />
      <path d="M132 82 a8 8 0 1 1 -2 12" className="cn-a-line" />
      <g className="cn-on-fail">
        <rect x="141" y="100" width="22" height="18" rx="4" className="cn-a-f cn-fc-coral" />
        <path d="M146 100 v-6 a6 6 0 0 1 12 0 v6" className="cn-a-line" />
        <path d="M146 106 l10 8 M156 106 l-10 8" className="cn-a-line cn-a-line--onfill" />
      </g>
      <g className="cn-on-live">
        <path d="M134 112 h26 l-3 18 h-20 z" className="cn-a-f cn-fc-lime" />
      </g>
    </ArtSvg>
  );
}
