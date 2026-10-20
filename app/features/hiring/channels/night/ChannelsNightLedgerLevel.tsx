"use client";

import { useTranslations } from "next-intl";
import { KitSurface } from "@/app/_components/kit";
import { KeyHints, type Crumb } from "@/app/_components/kit/scene";
import type { useChannelData } from "../useChannelsData";
import type { useCommsFeed } from "../useCommsFeed";
import { ChannelsArt } from "./art/ChannelsArt";
import { ChannelsNightFrame } from "./ChannelsNightFrame";
import type { NightChannel, NightEntry } from "./channelsNightNav";
import { ChannelsNightLedger } from "./ledger/ChannelsNightLedger";
import { bookCondition } from "./ledger/channelsNightLedgerModel";

/**
 * Level 2, the ledger (the post book): the frame (its drawing in the head, coloured by the book's
 * condition), the body (night/ledger/ChannelsNightLedger: the relay's truth, the chips, facets,
 * search, the windowed rows) and the keys it answers to. It opens with the filter it was given
 * (the dead letters from a needs-you item, the queue, a channel's roles) and hands a row to level 3
 * with the list AS FILTERED. The shell's `KEYS_*` vocabulary has no words for a table, so the
 * level states its own keys (channelsNight.ledger.keys) with the kit's KeyHints in the foot.
 */
export function ChannelsNightLedgerLevel({ entry, feed, data, crumbs, onBack, onOpenMessage, onOpenChannel }: {
  entry: Extract<NightEntry, { level: 2 }>;
  feed: ReturnType<typeof useCommsFeed>;
  data: ReturnType<typeof useChannelData>;
  crumbs: readonly Crumb[];
  onBack: () => void;
  onOpenMessage: (id: string, list: string[], el: HTMLElement | null) => void;
  onOpenChannel: (channel: NightChannel, el: HTMLElement | null) => void;
}) {
  const ts = useTranslations("channelsNight.shell");
  const tl = useTranslations("channelsNight.ledger");
  const tk = useTranslations("channelsNight.ledger.keys");
  const keys = [
    { id: "row", keys: [tk("rows"), tk("step")], act: tk("row") },
    { id: "open", keys: [ts("keyNames.enter")], act: ts("keyActs.open") },
    { id: "search", keys: [tk("slash")], act: tk("search") },
    { id: "verdict", keys: [tk("digits")], act: tk("verdict") },
    { id: "back", keys: [ts("keyNames.esc")], act: ts("keyActs.back") },
  ];
  return (
    <ChannelsNightFrame
      ground="book"
      kicker={ts("kicker.ledger")}
      title={tl("title")}
      lead={tl("lead")}
      crumbs={crumbs}
      onBack={onBack}
      keys={[]}
      artPlace="head"
      art={
        <div className="cn-ledger__book" data-cond={bookCondition(feed.feed.messages, feed.relayConfigured)}>
          <ChannelsArt node="book" />
        </div>
      }
      foot={<KeyHints label={ts("keysLabel")} hints={keys} />}
    >
      <KitSurface>
        <ChannelsNightLedger entry={entry} feed={feed} data={data} onOpenMessage={onOpenMessage} onOpenChannel={onOpenChannel} />
      </KitSurface>
    </ChannelsNightFrame>
  );
}
