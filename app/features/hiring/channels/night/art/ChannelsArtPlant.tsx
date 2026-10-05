/*
 * The district's three works: the studio (where everything meets), the relay depot (outbound
 * mail; its shutter rolls up and its barrier lifts only when a relay is proven), the night box
 * (the always-on edge; its lamp is lit only while paired). Classes only, both themes: see
 * night/README.md "Art".
 */
import { ArtSvg } from "./ChannelsArtSvg";

export function ChannelsArtStudio() {
  return (
    <ArtSvg viewBox="0 -24 290 230" name="studio">
      <ellipse cx="146" cy="196" rx="132" ry="8" className="cn-a-gnd" />
      <rect x="26" y="84" width="240" height="112" rx="8" className="cn-a-f cn-fc-cream" />
      <path d="M18 86 V52 L86 86 V52 L154 86 V52 L222 86 V52 L272 86 Z" className="cn-a-f cn-fc-amber" />
      <rect x="226" y="14" width="24" height="60" className="cn-a-f cn-fc-steel" />
      <rect x="220" y="10" width="36" height="10" rx="3" className="cn-a-f cn-fc-ink" />
      <g className="cn-smoke">
        <circle cx="238" cy="-2" r="8" className="cn-a-st cn-fc-paper" />
        <circle cx="246" cy="-16" r="10" className="cn-a-st cn-fc-paper" />
      </g>
      <rect x="44" y="108" width="36" height="26" rx="5" className="cn-a-f cn-fc-sky" />
      <rect x="212" y="108" width="36" height="26" rx="5" className="cn-a-f cn-fc-sky" />
      <rect x="104" y="98" width="86" height="26" rx="8" className="cn-a-f cn-fc-paper" />
      <rect x="114" y="106" width="22" height="10" rx="3" className="cn-a-f cn-fc-coral" />
      <path d="M144 111 H178" className="cn-a-line" />
      <rect x="112" y="136" width="70" height="60" rx="4" className="cn-a-f cn-fc-moss" />
      <rect x="60" y="178" width="172" height="12" rx="6" className="cn-a-f cn-fc-ink" />
      <g>
        {[76, 104, 188, 216].map((cx) => <circle key={cx} cx={cx} cy="184" r="4" className="cn-fc-cream" />)}
      </g>
    </ArtSvg>
  );
}

export function ChannelsArtRelay() {
  return (
    <ArtSvg viewBox="0 0 250 176" name="relay">
      <ellipse cx="116" cy="168" rx="108" ry="8" className="cn-a-gnd" />
      <rect x="22" y="52" width="162" height="114" rx="8" className="cn-a-f cn-fc-cream" />
      <path d="M10 54 L32 22 H174 L196 54 Z" className="cn-a-f cn-fc-coral" />
      <rect x="72" y="30" width="62" height="18" rx="6" className="cn-a-f cn-fc-paper" />
      <path d="M106 32 l-8 9 h7 l-4 7 l12 -11 h-7 z" className="cn-a-f cn-fc-amber" />
      <rect x="44" y="84" width="68" height="82" rx="4" className="cn-a-f cn-fc-ink" />
      <g className="cn-shutter">
        <rect x="44" y="84" width="68" height="82" rx="4" className="cn-a-f cn-fc-steel" />
        <path d="M44 102 H112 M44 120 H112 M44 138 H112 M44 154 H112" className="cn-a-line" />
      </g>
      <rect x="128" y="80" width="36" height="34" rx="6" className="cn-a-f cn-win" />
      <path d="M146 80 V114" className="cn-a-line" />
      <g className="cn-on-off">
        <path d="M150 52 V36" className="cn-a-line" />
        <g transform="rotate(-6 160 135)">
          <rect x="132" y="120" width="56" height="30" rx="6" className="cn-a-f cn-fc-paper" />
          <path d="M148 128 l24 14 M172 128 l-24 14" className="cn-a-line cn-a-line--alarm" />
        </g>
      </g>
      <g className="cn-on-live">
        <rect x="176" y="110" width="64" height="36" rx="8" className="cn-a-f cn-fc-paper" />
        <path d="M212 110 h16 a12 12 0 0 1 12 12 v24 h-28 Z" className="cn-a-f cn-fc-lime" />
        <circle cx="194" cy="150" r="9" className="cn-a-f cn-fc-ink" />
        <circle cx="226" cy="150" r="9" className="cn-a-f cn-fc-ink" />
        <path d="M186 122 h8 M190 128 h10" className="cn-a-line" />
      </g>
    </ArtSvg>
  );
}

export function ChannelsArtEdge() {
  return (
    <ArtSvg viewBox="0 0 150 176" name="edge">
      <ellipse cx="74" cy="168" rx="56" ry="7" className="cn-a-gnd" />
      <g className="cn-on-live">
        <path d="M74 54 L-6 98 L-6 20 Z" className="cn-beam" />
        <path d="M74 54 L154 98 L154 20 Z" className="cn-beam" />
      </g>
      <rect x="66" y="92" width="16" height="70" className="cn-a-f cn-fc-steel" />
      <rect x="50" y="156" width="48" height="12" rx="4" className="cn-a-f cn-fc-ink" />
      <path d="M46 50 L74 24 L102 50 Z" className="cn-a-f cn-fc-coral" />
      <rect x="52" y="50" width="44" height="44" rx="7" className="cn-a-f cn-lantern" />
      <path d="M74 50 V94 M52 72 H96" className="cn-a-line" />
      <rect x="46" y="92" width="56" height="9" rx="4" className="cn-a-f cn-fc-ink" />
      <rect x="86" y="118" width="46" height="34" rx="7" className="cn-a-f cn-fc-coral" />
      <rect x="96" y="127" width="26" height="7" rx="3.5" className="cn-a-f cn-fc-ink" />
      <g className="cn-on-sealed">
        <rect x="16" y="120" width="26" height="22" rx="5" className="cn-a-f cn-fc-amber" />
        <path d="M22 120 v-7 a7 7 0 0 1 14 0 v7" className="cn-a-line" />
      </g>
    </ArtSvg>
  );
}
