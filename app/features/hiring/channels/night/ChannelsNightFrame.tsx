"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { KeyHints, LevelFrame, LevelTrail, type Crumb, type LevelTone } from "@/app/_components/kit/scene";
import type { NightChannel } from "./channelsNightNav";

export type KeyName = "tab" | "arrows" | "enter" | "esc" | "leftRight";
export type KeyAct = "move" | "open" | "back" | "channel";
export type KeyHint = { keys: readonly KeyName[]; act: KeyAct };

/** Level 0 walks the district; a level below goes back with Esc (and steps sideways on level 1). */
export const KEYS_PLUMBING: readonly KeyHint[] = [
  { keys: ["tab", "arrows"], act: "move" },
  { keys: ["enter"], act: "open" },
];
export const KEYS_LEVEL: readonly KeyHint[] = [{ keys: ["esc"], act: "back" }];
export const KEYS_CHANNEL: readonly KeyHint[] = [{ keys: ["leftRight"], act: "channel" }, ...KEYS_LEVEL];

/** The token each place's level is tinted with (the rest, and the post book, stay steel). */
const GROUND: Partial<Record<NightChannel | "book", LevelTone>> = { careers: "moss", ads: "coral", feeds: "amber", edge: "stone" };

/**
 * The Night Post's binding of the kit's level frame (app/_components/kit/scene: `LevelFrame`,
 * `LevelTrail`, `KeyHints`): the channel's ground as the frame's tone, and the trail's and the keys'
 * words from `channelsNight.shell`. Every level below the plumbing renders inside it; its heading
 * takes focus when the level opens (`data-level-heading`). night/README.md is the contract.
 */
export function ChannelsNightFrame({ ground, crumbs, onBack, keys, ...frame }: {
  ground: NightChannel | "book";
  kicker: string;
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
  /** A drawing of the place (decorative, with its condition beside it). */
  art?: ReactNode;
  artPlace?: "side" | "head";
  crumbs: readonly Crumb[];
  onBack: () => void;
  foot?: ReactNode;
  keys: readonly KeyHint[];
  children: ReactNode;
}) {
  const t = useTranslations("channelsNight.shell");
  const parent = crumbs[crumbs.length - 2];
  return (
    <LevelFrame
      {...frame}
      tone={GROUND[ground] ?? "steel"}
      trail={<LevelTrail crumbs={crumbs} onBack={onBack} backLabel={t("back", { place: parent?.label ?? "" })} label={t("crumbsLabel")} />}
      keys={<ChannelsNightKeys hints={keys} />}
    />
  );
}

/** The keys a Night Post level answers to, in the reader's words (the kit's `KeyHints`). */
export function ChannelsNightKeys({ hints }: { hints: readonly KeyHint[] }) {
  const t = useTranslations("channelsNight.shell");
  return (
    <KeyHints
      label={t("keysLabel")}
      hints={hints.map((h) => ({ id: h.act, keys: h.keys.map((k) => t(`keyNames.${k}`)), act: t(`keyActs.${h.act}`) }))}
    />
  );
}
