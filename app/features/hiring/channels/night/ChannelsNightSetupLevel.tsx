"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, KitSurface } from "@/app/_components/kit";
import type { Crumb } from "@/app/_components/kit/scene";
import type { useChannelData } from "../useChannelsData";
import { ChannelsNightFrame, KEYS_CHANNEL } from "./ChannelsNightFrame";
import { CHANNEL_BLURB, NODE_NAME } from "./channelsNightCopy";
import type { LedgerVerdict, NightChannel } from "./channelsNightNav";
import type { Plate, VerdictCounts } from "./channelsNightPlumbing";
import { relayScene, type RelayTest } from "./setup/setupDelivery";
import { SetupArt } from "./setup/SetupArt";
import { SetupStatus } from "./setup/SetupBits";
import { SetupCareers } from "./setup/SetupCareers";
import { SetupEdge } from "./setup/SetupEdge";
import { SetupFeeds } from "./setup/SetupFeeds";
import { SetupReceivers } from "./setup/SetupReceivers";
import { SetupRelay } from "./setup/SetupRelay";
import { SetupStepper } from "./setup/SetupStepper";
import { usePlateWords } from "./useChannelsNightWords";
import "./setup/setup.css";

export type LedgerScope = { verdict?: LedgerVerdict; role?: string };

/**
 * Level 1, one channel's setup (night/README.md; parity rows D1-D10): the frame (trail, the
 * channel's name and one line, "Open the ledger" except for the edge, which sends no mail), the
 * channel's drawing with its condition, the status strip (the plate's words: condition and one
 * fact), the channel's real setup, and the stepper (previous / next by name, a dot per channel, also
 * ← →). The relay's test answer is held here: it is what rolls the depot's shutter up.
 */
export function ChannelsNightSetupLevel({ channel, focus, plates, counts, data, crumbs, onBack, onStep, onGo, onOpenLedger }: {
  channel: NightChannel;
  focus: string | null;
  plates: Record<NightChannel, Plate>;
  counts: VerdictCounts | null;
  data: ReturnType<typeof useChannelData>;
  crumbs: readonly Crumb[];
  onBack: () => void;
  onStep: (delta: 1 | -1) => void;
  onGo: (channel: NightChannel) => void;
  onOpenLedger: (from: NightChannel, el: HTMLElement, scope?: LedgerScope) => void;
}) {
  const t = useTranslations();
  const ts = useTranslations("channelsNight.shell");
  const { words } = usePlateWords();
  const [relayTest, setRelayTest] = useState<RelayTest | null>(null);
  const plate = plates[channel];
  const w = words(plate);
  const scene = channel === "relay" ? relayScene(plate.condition, relayTest?.kind ?? null) : null;
  const answered = scene?.answered ?? false;

  return (
    <ChannelsNightFrame
      ground={channel}
      kicker={ts("kicker.setup")}
      title={t(NODE_NAME[channel])}
      lead={t(CHANNEL_BLURB[channel])}
      crumbs={crumbs}
      onBack={onBack}
      keys={KEYS_CHANNEL}
      artPlace="side"
      actions={channel === "edge" ? null : <Button label={ts("openLedger")} icon="right" onClick={(e) => onOpenLedger(channel, e.currentTarget)} />}
      art={
        <SetupArt
          channel={channel}
          condition={scene?.condition ?? plate.condition}
          words={answered ? t("channelsNight.setup.relay.answered") : w.chip}
          loud={plate.alert}
          sealed={Boolean(plate.sealed)}
          gateUp={scene?.gateUp}
        />
      }
      foot={<SetupStepper channel={channel} plates={plates} onStep={onStep} onGo={onGo} />}
    >
      <KitSurface>
        <SetupStatus condition={plate.condition} title={w.chip} fact={w.fact} loud={plate.alert} />
        {channel === "careers" ? (
          <SetupCareers jobs={data.jobs} onArrived={data.reload} />
        ) : channel === "email" || channel === "ads" ? (
          <SetupReceivers section={channel} data={data} focus={focus} onMessages={(role, el) => onOpenLedger(channel, el, { role })} />
        ) : channel === "feeds" ? (
          <SetupFeeds data={data} focus={focus} onGo={onGo} />
        ) : channel === "relay" ? (
          <SetupRelay counts={counts} onTested={setRelayTest} onOpenLedger={(el, verdict) => onOpenLedger(channel, el, { verdict })} />
        ) : (
          <SetupEdge />
        )}
      </KitSurface>
    </ChannelsNightFrame>
  );
}
