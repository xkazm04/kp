"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Note } from "@/app/_components/kit";
import type { ChannelJob } from "../useChannelsData";
import { ChannelsNightHead } from "./ChannelsNightHead";
import { ChannelsNightKeys, KEYS_PLUMBING } from "./ChannelsNightFrame";
import { ChannelsNightNeeds } from "./ChannelsNightNeeds";
import { ChannelsNightStage } from "./ChannelsNightStage";
import { ChannelsNightStreet } from "./ChannelsNightStreet";
import type { NightChannel } from "./channelsNightNav";
import { NEEDS_SHOWN, type NeedItem, type PlumbingInput, type PlumbingModel } from "./channelsNightPlumbing";

/** Below this sheet width the district reads as a street of cards (the stage would shrink its
 *  plates under the 14px floor's room). */
const STREET_BELOW = 760;

/**
 * Level 0, the whole plumbing: the head (headline, figures, the two actions), the district (or
 * the street on a narrow sheet), what needs a person worst first, and the keys. Every word and
 * condition comes from channelsNightPlumbing.ts over the real state the shell reads.
 */
export function ChannelsNightPlumbingView({ input, model, jobs, loadFailed, onReload, onOpen, onNeed }: {
  input: PlumbingInput;
  model: PlumbingModel;
  jobs: ChannelJob[] | null;
  loadFailed: boolean;
  onReload: () => void;
  onOpen: (node: NightChannel | "book", el: HTMLElement) => void;
  onNeed: (item: NeedItem, el: HTMLElement) => void;
}) {
  const t = useTranslations("channelsNight.plumbing");
  const tc = useTranslations("channels");
  const ref = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  const [arrivals, setArrivals] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // A covered level is display:none and measures 0: that is not a narrow sheet, so it is ignored
    // (switching to the street there would unmount the building a closing level returns to).
    const ro = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWide(entry.contentRect.width >= STREET_BELOW);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { plates, needs, figures, headline, queued, relayOpen } = model;
  const top = needs[0] && needs[0].sev >= NEEDS_SHOWN ? needs[0] : null;

  return (
    <div ref={ref} className="cn-plumbing">
      <ChannelsNightHead
        headline={headline}
        figures={figures}
        jobs={jobs}
        loadFailed={loadFailed}
        onReload={onReload}
        onArrived={() => setArrivals((n) => n + 1)}
      />
      <div className="cn-plumbing__body">
        <section className="cn-scene" aria-label={t("sceneLabel")}>
          {wide ? (
            <ChannelsNightStage
              plates={plates}
              waiting={input.waiting}
              queued={queued}
              relayOpen={relayOpen}
              top={top}
              arrivals={arrivals}
              onOpen={onOpen}
              onNeed={onNeed}
            />
          ) : (
            <ChannelsNightStreet plates={plates} waiting={input.waiting} onOpen={onOpen} />
          )}
        </section>
        <ChannelsNightNeeds needs={needs} onOpen={onNeed} />
      </div>
      {input.receiversTruncated ? <Note tone="caution">{tc("receiversTruncated")}</Note> : null}
      <ChannelsNightKeys hints={KEYS_PLUMBING} />
    </div>
  );
}
