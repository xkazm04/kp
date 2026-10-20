"use client";

import { ConditionMark, type Condition } from "@/app/_components/kit/scene";
import { ChannelsArt } from "../art/ChannelsArt";
import { ArtSvg } from "../art/ChannelsArtSvg";
import type { NightChannel } from "../channelsNightNav";

/**
 * Level 1's drawing of the place, beside the sheet: the district's own art for the channel,
 * coloured by the channel's condition (`data-cond`, so both registers draw it from one geometry),
 * and the condition in shape and words under it. The relay depot stands behind its gate: the
 * barrier lifts while a readable relay is configured, and the shutter rolls up only when delivery
 * is proven (a sent row, or a test ping the relay has just answered). Both move once, on the
 * state change, and not at all under reduced motion (channelsNightScene.css).
 */
export function SetupArt({ channel, condition, words, loud, sealed, gateUp }: {
  channel: NightChannel;
  condition: Condition;
  words: string;
  loud: boolean;
  sealed: boolean;
  /** The relay only: the barrier is up. */
  gateUp?: boolean;
}) {
  return (
    <div className="cn-bigart cns-art" data-cond={condition} data-sealed={sealed ? "1" : undefined}>
      <ChannelsArt node={channel} />
      {channel === "relay" ? <Gate up={Boolean(gateUp)} /> : null}
      <ConditionMark condition={condition} label={words} loud={loud} />
    </div>
  );
}

/** The barrier across the depot's road, drawn like the district's (the same classes and motion). */
function Gate({ up }: { up: boolean }) {
  return (
    <ArtSvg viewBox="-60 -40 240 70" name="gate">
      <path d="M-56 14 H176" className="cn-a-line cn-a-line--rule" />
      <g className="cn-barrier" data-up={up ? "1" : undefined}>
        <rect x="-48" y="-11" width="14" height="24" rx="3" className="cn-a-f cn-fc-steel" />
        <g className="cn-barrier__arm">
          <rect x="-38" y="-7" width="176" height="14" rx="3" className="cn-a-f cn-fc-paper" />
          <path d="M-20 -7 l11 14 h-11z M16 -7 l11 14 h-11z M52 -7 l11 14 h-11z M88 -7 l11 14 h-11z M120 -7 l11 14 h-11z" className="cn-fc-coral" />
        </g>
      </g>
    </ArtSvg>
  );
}
