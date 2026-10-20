/*
 * One letter, drawn big for level 3: the envelope, the paper inside, a postmark, and the verdict's
 * stamp (its glyph and fill say the verdict; the ConditionMark beside the drawing says it in words).
 * Decorative (aria-hidden via ArtSvg), coloured ONLY through the district's classes (night/README.md
 * "Art"), so the one geometry renders in both registers.
 */
import type { CommsVerdict } from "@/app/_lib/comms-view";
import { ArtSvg } from "../art/ChannelsArtSvg";

const STAMP: Record<CommsVerdict, { fill: string; glyph: string }> = {
  sent: { fill: "cn-fc-moss", glyph: "M183 94 l8 8 l16 -18" },
  recovered: { fill: "cn-fc-moss", glyph: "M208 94 a11 11 0 1 1 -4 -8 M208 80 v9 h-9" },
  queued: { fill: "cn-fc-amber", glyph: "M197 82 v14 l10 6" },
  failed: { fill: "cn-fc-coral", glyph: "M185 82 l24 24 M209 82 l-24 24" },
  bounced: { fill: "cn-fc-coral", glyph: "M190 84 l-8 10 l8 10 M182 94 h20 a8 8 0 0 1 8 8" },
  orphaned: { fill: "cn-fc-steel", glyph: "M189 88 a8 8 0 1 1 11 7 c-3 1 -4 4 -4 7 M196 110 v.5" },
};

export function ChannelsNightEnvelope({ verdict }: { verdict: CommsVerdict }) {
  const stamp = STAMP[verdict];
  return (
    <ArtSvg viewBox="0 0 260 200" name="envelope">
      <ellipse cx="130" cy="188" rx="108" ry="8" className="cn-a-gnd" />
      <rect x="44" y="34" width="172" height="112" rx="6" className="cn-a-f cn-fc-paper" />
      <path d="M62 58 H170 M62 74 H190 M62 90 H150 M62 106 H178" className="cn-a-line cn-a-line--rule" />
      <rect x="22" y="62" width="216" height="120" rx="10" className="cn-a-f cn-fc-cream" />
      <path d="M22 72 L130 140 L238 72" className="cn-a-line" />
      <path d="M22 182 L98 122 M238 182 L162 122" className="cn-a-line" />
      <path d="M22 66 L130 138 L238 66 Z" className="cn-a-f cn-fc-lime" />
      <circle cx="196" cy="150" r="22" className="cn-a-f cn-fc-paper" />
      <circle cx="196" cy="150" r="15" className="cn-a-line" />
      <rect x="170" y="74" width="54" height="40" rx="5" className={`cn-a-f ${stamp.fill}`} />
      <path d={stamp.glyph} className="cn-a-line cn-a-line--onfill" />
    </ArtSvg>
  );
}
