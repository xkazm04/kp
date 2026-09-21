"use client";

import { useState, type ReactNode } from "react";
import { readStoredZones, storeZones, toggleZone, zoneKeyGuard } from "./studioZones";
import { StudioZone } from "./StudioZone";
import { useStudioTranslations } from "./useStudioTranslations";

// THE DESK — a designer's plane, not three chat boxes.
//
// The same zones, the same information and every behaviour of a chat-and-panel
// layout, with the boxes replaced by PLANES: one continuous white surface, zones
// separated by a hairline, hierarchy carried by type and space. The zone head is
// quiet and sticky, its count is a bare tabular numeral rather than a pill, and
// the fold control only exists while the pointer or the keyboard is inside the
// zone. The doctrine — NO SENTENCE OCCUPIES LAYOUT — is stated once, in
// studioZones.ts, beside the toggle rule it constrains.
//
// WHAT THE KIT OWNS: the zone walk, the fold state (stored under the consumer's
// `storageKey`, SSR-guarded), the min-one-open and pinned guards, and the
// transcript-then-composer stacking in the conversation zone.
//
// WHAT THE CONSUMER OWNS, AS PROPS: the zone vocabulary `K` and its order, which
// zone is the plane and what the plane IS (`plane` — a hiring brief, a CV sheet,
// a posting), any extra zones (`extra` — a draft, materials), and per-zone facts
// the head shows (`meta`: the numeral, its meaning, busy). A consumer that needs
// to open a zone from elsewhere (a paperclip glyph revealing the materials) runs
// the desk CONTROLLED (`open` + `onOpenChange`) with the same helpers.
//
// ONE PLANE, ONE HEIGHT. The host's container bounds the height (the overlay's
// modal body, 92dvh), so the desk fills it and never claims one of its own; below
// xl the zones stack and the dialog scrolls.
//
// Strings: `<ns>.columns.col.<zone>` (the zone's name), plus StudioZone's own.

export type StudioZones<K extends string> = {
  keys: readonly K[];
  storageKey: string;
  /** Zones that cannot be hidden (the transcript, always). */
  pinned: readonly K[];
};

export type StudioZoneMeta = {
  /** A bare numeral, or a one-glyph state. Defaults to nothing. */
  count?: string;
  /** What the numeral means — the fold control's tooltip. Defaults to the zone's name. */
  countHint?: string;
  /** The reply in flight will rewrite this zone. Defaults to `sending` for every
   *  zone but the transcript's. */
  busy?: boolean;
  /** Flex share at xl. Defaults to 1.5 for the transcript, 1 elsewhere. */
  grow?: string;
};

export type StudioDeskProps<K extends string> = {
  zones: StudioZones<K>;
  /** The right-hand plane (a hiring brief, a CV sheet, a posting sheet). */
  plane: ReactNode;
  planeZone: K;
  transcript: ReactNode;
  composer: ReactNode;
  /** Optional extra zones keyed by zone id (intake: draft, materials). */
  extra?: Partial<Record<K, ReactNode>>;
  ns: string;
  /** Which zone stacks transcript over composer. Defaults to the first key that
   *  is neither the plane nor an extra. */
  transcriptZone?: K;
  /** Per-zone head facts. */
  meta?: Partial<Record<K, StudioZoneMeta>>;
  /** A turn is in flight — the non-transcript zones pulse. */
  sending?: boolean;
  /** Zones open on first paint when nothing is stored. Defaults to all. */
  defaultOpen?: readonly K[];
  /** Controlled mode: the consumer holds the open set (and persists it with
   *  `storeZones`) — needed when something outside the desk must open a zone. */
  open?: K[];
  onOpenChange?(next: K[]): void;
};

export function StudioDesk<K extends string>({
  zones,
  plane,
  planeZone,
  transcript,
  composer,
  extra,
  ns,
  transcriptZone,
  meta,
  sending = false,
  defaultOpen,
  open: controlledOpen,
  onOpenChange,
}: StudioDeskProps<K>) {
  const t = useStudioTranslations(ns);
  const [ownOpen, setOwnOpen] = useState<K[]>(() =>
    readStoredZones(zones.storageKey, [...(defaultOpen ?? zones.keys)], zoneKeyGuard(zones.keys))
  );
  const open = controlledOpen ?? ownOpen;
  const chatZone = transcriptZone ?? zones.keys.find((k) => k !== planeZone && !(extra && k in extra)) ?? zones.keys[0];

  const flip = (key: K) => {
    const next = toggleZone(open, key, zones.pinned);
    if (next === open) return;
    if (onOpenChange) onOpenChange(next);
    if (controlledOpen === undefined) {
      setOwnOpen(next);
      storeZones(zones.storageKey, next);
    }
  };

  return (
    <div className="flex min-h-0 shrink-0 flex-col xl:h-full xl:flex-1 xl:shrink xl:flex-row xl:items-stretch">
      {zones.keys.map((key, i) => {
        const isOpen = open.includes(key);
        const label = t(`columns.col.${key}`);
        const m = meta?.[key];
        const isChat = key === chatZone;
        return (
          <StudioZone
            key={key}
            zoneKey={key}
            label={label}
            count={m?.count ?? ""}
            countHint={m?.countHint ?? label}
            open={isOpen}
            canFold={!(isOpen && open.length === 1) && !zones.pinned.includes(key)}
            onToggle={() => flip(key)}
            ns={ns}
            busy={m?.busy ?? (sending && !isChat)}
            first={i === 0}
            grow={m?.grow ?? (isChat ? "xl:flex-[1.5]" : "xl:flex-1")}
            scroll={!isChat}
          >
            {isChat ? (
              <>
                {transcript}
                {composer}
              </>
            ) : key === planeZone ? (
              plane
            ) : (
              extra?.[key]
            )}
          </StudioZone>
        );
      })}
    </div>
  );
}
