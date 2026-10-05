/*
 * The post book (the ledger), the candidates' houses (who the mail is for; their flags go up
 * only when a relay can reach them) and one envelope (a letter on a road). Classes only: see
 * night/README.md "Art".
 */
import { ArtSvg } from "./ChannelsArtSvg";

// The book's index tabs, one per verdict family, coloured by the tab's token class.
const TABS = ["cn-fc-amber", "cn-fc-moss", "cn-fc-lime", "cn-fc-coral", "cn-fc-steel", "cn-fc-sky"];

export function ChannelsArtBook() {
  return (
    <ArtSvg viewBox="0 0 230 170" name="book">
      <ellipse cx="114" cy="162" rx="100" ry="7" className="cn-a-gnd" />
      <path d="M16 50 L112 64 V146 L16 130 Z" className="cn-a-f cn-fc-cream" />
      <path d="M112 64 L208 50 V130 L112 146 Z" className="cn-a-f cn-fc-paper" />
      <path d="M112 64 V146" className="cn-a-line" />
      <path
        d="M28 70 L100 80 M28 86 L100 96 M28 102 L100 112 M28 118 L100 128 M124 80 L196 70 M124 96 L196 86 M124 112 L196 102 M124 128 L196 118"
        className="cn-a-line cn-a-line--rule"
      />
      {TABS.map((fill, i) => <rect key={fill} x="206" y={52 + i * 13} width="16" height="11" rx="3" className={`cn-a-f ${fill}`} />)}
      <g className="cn-on-fail">
        <path d="M22 132 H78 L70 158 H30 Z" className="cn-a-f cn-fc-coral" />
        <rect x="34" y="118" width="32" height="22" rx="3" className="cn-a-f cn-fc-paper" transform="rotate(-8 50 129)" />
        <rect x="38" y="114" width="30" height="22" rx="3" className="cn-a-f cn-fc-lime" transform="rotate(7 53 125)" />
      </g>
      <rect x="150" y="18" width="36" height="22" rx="4" className="cn-a-f cn-fc-coral" />
      <rect x="156" y="8" width="24" height="12" rx="4" className="cn-a-f cn-fc-ink" />
    </ArtSvg>
  );
}

const HOUSES = [
  { x: 2, body: "cn-fc-lime", roof: "cn-fc-coral", flag: "cn-fc-coral" },
  { x: 98, body: "cn-fc-paper", roof: "cn-fc-steel", flag: "cn-fc-amber" },
  { x: 194, body: "cn-fc-cream", roof: "cn-fc-moss", flag: "cn-fc-coral" },
];

export function ChannelsArtHouses() {
  return (
    <ArtSvg viewBox="0 0 290 120" name="houses">
      <ellipse cx="146" cy="112" rx="136" ry="7" className="cn-a-gnd" />
      {HOUSES.map((h) => (
        <g key={h.x} transform={`translate(${h.x} 0)`}>
          <rect x="8" y="58" width="56" height="46" rx="4" className={`cn-a-f ${h.body}`} />
          <path d="M0 60 L36 28 L72 60 Z" className={`cn-a-f ${h.roof}`} />
          <rect x="28" y="78" width="16" height="26" rx="3" className="cn-a-f cn-fc-ink" />
          <rect x="14" y="68" width="10" height="10" rx="2" className="cn-a-f cn-fc-sky" />
          <rect x="48" y="68" width="10" height="10" rx="2" className="cn-a-f cn-fc-sky" />
          <rect x="74" y="86" width="5" height="22" className="cn-a-f cn-fc-steel" />
          <rect x="68" y="76" width="18" height="12" rx="4" className="cn-a-f cn-fc-paper" />
          <path d="M86 80 V68 L94 72 L86 76" className={`cn-a-f ${h.flag} cn-flag`} />
        </g>
      ))}
    </ArtSvg>
  );
}

/** One letter, drawn around (0, 0) so a road can place it with a transform. */
export function ChannelsArtEnvelope({ tone = "paper" }: { tone?: "paper" | "lime" | "coral" }) {
  return (
    <g className="cn-env">
      <rect x="-13" y="-9" width="26" height="18" rx="3" className={`cn-a-f cn-fc-${tone}`} />
      <path d="M-13 -8 L0 2 L13 -8" className="cn-a-line" />
    </g>
  );
}
