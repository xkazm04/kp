"use client";

import { useTranslations } from "next-intl";
import { Button, Mark } from "@/app/_components/kit";
import { ScenePress } from "@/app/_components/kit/scene";
import { CONDITION_MARK } from "@/app/_components/kit/scene/conditions";
import { NODE_NAME } from "../channelsNightCopy";
import { NIGHT_CHANNELS, stepChannel, type NightChannel } from "../channelsNightNav";
import type { Plate } from "../channelsNightPlumbing";
import { usePlateWords } from "../useChannelsNightWords";

/* A dot is drawn scene furniture (its condition's shape at 16px), not a labelled button: it is the kit's
   ScenePress, painted by setup.css `.cns-dot`, the way the district's buildings are. */

/**
 * The walk between the six channels at level 1: the previous and next channel by name (also ← →),
 * and one dot per channel carrying its condition in shape and, for a screen reader, in words; the
 * current one is marked. Every control keeps a `data-level-key`, so a sideways step leaves focus on
 * the control that made it. A dot is a sideways step to that channel (the level's `onGo`).
 */
export function SetupStepper({ channel, plates, onStep, onGo }: {
  channel: NightChannel;
  plates: Record<NightChannel, Plate>;
  onStep: (delta: 1 | -1) => void;
  onGo: (channel: NightChannel) => void;
}) {
  const t = useTranslations();
  const ts = useTranslations("channelsNight.shell");
  const tsu = useTranslations("channelsNight.setup.stepper");
  const { words } = usePlateWords();
  return (
    <nav className="cns-stepper" aria-label={tsu("label")}>
      <Button label={ts("prevChannel", { channel: t(NODE_NAME[stepChannel(channel, -1)]) })} icon="left" size="sm" onClick={() => onStep(-1)} data-level-key="step-prev" />
      <ol className="cns-dots">
        {NIGHT_CHANNELS.map((id) => {
          const cond = plates[id].condition;
          const here = id === channel;
          return (
            <li key={id}>
              <ScenePress
                className="cns-dot"
                data-cond={cond}
                aria-current={here ? "step" : undefined}
                aria-label={tsu("dot", { channel: t(NODE_NAME[id]), state: words(plates[id]).chip })}
                data-level-key={`dot-${id}`}
                onClick={() => (here ? undefined : onGo(id))}
              >
                <span aria-hidden="true">
                  <Mark kind={CONDITION_MARK[cond]} />
                </span>
              </ScenePress>
            </li>
          );
        })}
      </ol>
      <span className="cns-stepper__at">{ts("channelPosition", { index: NIGHT_CHANNELS.indexOf(channel) + 1, total: NIGHT_CHANNELS.length })}</span>
      <Button label={ts("nextChannel", { channel: t(NODE_NAME[stepChannel(channel, 1)]) })} icon="right" size="sm" onClick={() => onStep(1)} data-level-key="step-next" />
    </nav>
  );
}
