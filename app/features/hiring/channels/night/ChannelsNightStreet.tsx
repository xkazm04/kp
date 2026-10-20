"use client";

import { useTranslations } from "next-intl";
import { NamePlate, ScenePress } from "@/app/_components/kit/scene";
import { ChannelsArt } from "./art/ChannelsArt";
import type { NightChannel } from "./channelsNightNav";
import type { StageProps } from "./ChannelsNightStage";
import { usePlateWords } from "./useChannelsNightWords";

const COMING_IN: readonly NightChannel[] = ["careers", "email", "ads", "feeds"];
const GOING_OUT: readonly (NightChannel | "book")[] = ["relay", "edge", "book"];

/**
 * Level 0 on a narrow sheet: the same buildings as a street of cards, the doors that bring
 * candidates in, the studio, then what goes out. Same plates, same buttons, same order of
 * reading as the district.
 */
export function ChannelsNightStreet({ plates, waiting, onOpen }: Pick<StageProps, "plates" | "waiting" | "onOpen">) {
  const t = useTranslations("channelsNight.plumbing");
  const tc = useTranslations("channels");
  const { words } = usePlateWords();
  const card = (id: NightChannel | "book") => {
    const p = plates[id];
    const w = words(p);
    return (
      <li key={id}>
        <ScenePress className="cn-card" data-night-node={id} data-cond={p.condition} data-alert={p.alert ? "1" : undefined} data-sealed={p.sealed ? "1" : undefined} onClick={(e) => onOpen(id, e.currentTarget)}>
          <span className="cn-card__art">
            <ChannelsArt node={id} />
          </span>
          <NamePlate title={w.title} condition={p.condition} chip={w.chip} fact={w.fact} alert={p.alert} />
        </ScenePress>
      </li>
    );
  };
  return (
    <div className="cn-street">
      <h3 className="cn-street__head">{t("comingIn")}</h3>
      <ul>{COMING_IN.map(card)}</ul>
      <div className="cn-street__studio" data-cond="live">
        <span className="cn-card__art">
          <ChannelsArt node="studio" />
        </span>
        <NamePlate title={t("studio")} fact={waiting === null ? tc("kit.notRead") : tc("waiting", { count: waiting })} />
      </div>
      <h3 className="cn-street__head">{t("goingOut")}</h3>
      <ul>{GOING_OUT.map(card)}</ul>
    </div>
  );
}
