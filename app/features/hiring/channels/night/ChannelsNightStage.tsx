"use client";

import { useTranslations } from "next-intl";
import { NamePlate, ScenePress } from "@/app/_components/kit/scene";
import { ChannelsArt } from "./art/ChannelsArt";
import { ChannelsNightWorld } from "./ChannelsNightWorld";
import { BUILDINGS, DOORS, PILE_T, ROADS, boxStyle, cubicAt, doorsStyle, notePoint, pointStyle, type RoadId } from "./channelsNightDistrict";
import type { NeedItem, NightNode, Plate } from "./channelsNightPlumbing";
import type { NightChannel } from "./channelsNightNav";
import { useNeedWords } from "./ChannelsNightNeeds";
import { usePlateWords } from "./useChannelsNightWords";

/* Buildings and the note are the kit's ScenePress (drawn furniture you press), painted by channelsNightScene.css. */
/** The queued count hangs from its right edge this far (design units) left of the relay plate, so a longer word grows away from it. */
const COUNT_GAP = 18;
const OPENABLE: readonly (NightChannel | "book")[] = ["edge", "relay", "book"];

export type StageProps = {
  plates: Record<Exclude<NightNode, "studio">, Plate>;
  waiting: number | null;
  queued: number;
  relayOpen: boolean;
  top: NeedItem | null;
  /** Bumps the studio once when a test application lands (0 = never). */
  arrivals: number;
  onOpen: (node: NightChannel | "book", el: HTMLElement) => void;
  onNeed: (item: NeedItem, el: HTMLElement) => void;
};

/**
 * Level 0 at full width: the district drawn from real state. Every building but the studio is a
 * button that opens its level; the ground (roads, barrier, the held pile) repeats the plates'
 * conditions in pictures; the one loudest fact (mail queued and NOT sent) sits on the relay road;
 * a "start here" note pins beside the building of the worst thing that needs a person.
 */
export function ChannelsNightStage({ plates, waiting, queued, relayOpen, top, arrivals, onOpen, onNeed }: StageProps) {
  const t = useTranslations("channelsNight.plumbing");
  const tc = useTranslations("channels");
  const { words } = usePlateWords();
  const needWords = useNeedWords();
  const roads: Record<RoadId, Plate["condition"]> = {
    careers: plates.careers.condition,
    email: plates.email.condition,
    ads: plates.ads.condition,
    feeds: plates.feeds.condition,
    edge: plates.edge.condition,
    relay: plates.relay.condition,
    // The road to the candidates carries letters only once a send proved it; open, it waits.
    out: plates.relay.condition === "live" ? "live" : relayOpen ? "wait" : "off",
    book: plates.book.condition === "unknown" ? "unknown" : "live",
  };
  // A door sits in the doors' column (its height follows its plate); every other building is placed on the map.
  const building = (id: NightChannel | "book", placed: boolean) => {
    const p = plates[id];
    const w = words(p);
    return (
      <ScenePress
        key={id}
        className="cn-node"
        data-night-node={id}
        data-cond={p.condition}
        data-sealed={p.sealed ? "1" : undefined}
        style={placed ? boxStyle(BUILDINGS[id]) : undefined}
        onClick={(e) => onOpen(id, e.currentTarget)}
      >
        <span className="cn-node__art">
          <ChannelsArt node={id} />
        </span>
        <NamePlate title={w.title} condition={p.condition} chip={w.chip} fact={w.fact} alert={p.alert} />
      </ScenePress>
    );
  };
  const pile = cubicAt(ROADS.relay, PILE_T);
  const note = top && top.node !== "studio" ? notePoint(top.node) : null;
  return (
    <div className="cn-stage">
      <ChannelsNightWorld roads={roads} relayOpen={relayOpen} held={queued} />
      <div className="cn-doors" style={doorsStyle()}>
        {DOORS.map((id) => building(id, false))}
      </div>
      {OPENABLE.map((id) => building(id, true))}
      <div className="cn-node cn-node--static" data-night-node="studio" data-cond="live" style={boxStyle(BUILDINGS.studio)}>
        <span key={arrivals} className="cn-node__art" data-bump={arrivals > 0 ? "1" : undefined}>
          <ChannelsArt node="studio" />
        </span>
        <NamePlate title={t("studio")} fact={waiting === null ? tc("kit.notRead") : tc("waiting", { count: waiting })} align="centre" />
      </div>
      <div className="cn-node cn-node--static cn-node--houses" data-cond={relayOpen ? "live" : "off"} style={boxStyle(BUILDINGS.houses)} aria-hidden="true">
        <span className="cn-node__art">
          <ChannelsArt node="houses" />
        </span>
        <span className="cn-caption">{t("houses")}</span>
      </div>
      {queued > 0 ? (
        <p className="cn-count" data-stuck={relayOpen ? undefined : "1"} style={pointStyle({ x: BUILDINGS.relay.x - COUNT_GAP, y: pile.y + 6 })}>
          <b>{queued}</b>
          <span>{relayOpen ? t("queued") : t("queuedNotSent")}</span>
        </p>
      ) : null}
      {top && note ? (
        <ScenePress className="cn-start" style={pointStyle(note)} aria-label={t("startHereLabel", { title: needWords(top, (c) => c).plainTitle })} onClick={(e) => onNeed(top, e.currentTarget)}>
          <span>{t("startHere")}</span>
          <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
            <path d="M6 6 C30 6 34 18 26 32" />
            <path d="M16 30 L26 34 L31 24" />
          </svg>
        </ScenePress>
      ) : null}
    </div>
  );
}
