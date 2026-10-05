"use client";

import { useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button, KitSurface } from "@/app/_components/kit";
import { ConditionMark, KeyHints, type Crumb } from "@/app/_components/kit/scene";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { commsVerdict } from "@/app/_lib/comms-view";
import { commsReceiptLabels, commsStatusLabels, displaySubject } from "../channelsCommsHelpers";
import type { useCommsFeed } from "../useCommsFeed";
import { ChannelsNightFrame } from "./ChannelsNightFrame";
import { stepMessage, type NightChannel, type NightEntry } from "./channelsNightNav";
import { ledgerName } from "./ledger/channelsNightLedgerModel";
import { useNightLevelKeys } from "./ledger/useNightLevelKeys";
import { ChannelsNightEnvelope } from "./message/ChannelsNightEnvelope";
import { ChannelsNightLetter } from "./message/ChannelsNightLetter";
import { letterCondition, messageNote } from "./message/channelsNightMessageModel";

/**
 * Level 3, one message: the frame (the letter's subject as the heading, its drawing and its
 * condition beside the sheet), the letter (night/message/ChannelsNightLetter), and the previous /
 * next message of the list it was opened from (the stepper, also [ and ]). A message outside the
 * loaded window (a deep link) says so instead of drawing a blank; the frame's trail and Esc go back.
 */
export function ChannelsNightMessageLevel({ entry, feed, crumbs, onBack, onStep, onOpenChannel }: {
  entry: Extract<NightEntry, { level: 3 }>;
  feed: ReturnType<typeof useCommsFeed>;
  crumbs: readonly Crumb[];
  onBack: () => void;
  onStep: (id: string) => void;
  onOpenChannel: (channel: NightChannel, el: HTMLElement | null) => void;
}) {
  const ts = useTranslations("channelsNight.shell");
  const tk = useTranslations("channelsNight.message.keys");
  const tc = useTranslations("channels.comms");
  const rootRef = useRef<HTMLDivElement>(null);
  const receipt = useMemo(() => commsReceiptLabels(tc), [tc]);
  const { messages, refs } = feed.feed;
  const m = messages?.find((x) => x.id === entry.id) ?? null;
  const at = entry.list.indexOf(entry.id);
  const prev = stepMessage(entry, -1);
  const next = stepMessage(entry, 1);
  const verdict = m ? commsVerdict(m) : null;

  useNightLevelKeys(rootRef, (e) => {
    const to = e.key === "[" ? prev : e.key === "]" ? next : null;
    if (to) onStep(to);
    return Boolean(to);
  });

  const hints = [
    ...(entry.list.length > 1 ? [{ id: "step", keys: [tk("brackets")], act: tk("step") }] : []),
    { id: "back", keys: [ts("keyNames.esc")], act: ts("keyActs.back") },
  ];
  return (
    <div ref={rootRef} className="cn-msg-level">
      <ChannelsNightFrame
        ground="book"
        kicker={ts("kicker.message")}
        title={m ? displaySubject(m, receipt) ?? ledgerName(m, refs, receipt) : ts("message")}
        crumbs={crumbs}
        onBack={onBack}
        keys={[]}
        art={
          verdict ? (
            <div className="cn-bigart cn-msg-art" data-cond={letterCondition(verdict)}>
              <ChannelsNightEnvelope verdict={verdict} />
              <ConditionMark condition={letterCondition(verdict)} label={commsStatusLabels(tc)[verdict]} loud={messageNote(verdict, feed.relayConfigured)?.tone === "critical"} />
            </div>
          ) : undefined
        }
        foot={
          <>
            {entry.list.length > 1 ? (
              <div className="cn-stepper">
                <Button label={ts("prevMessage")} icon="left" size="sm" disabled={!prev} onClick={() => prev && onStep(prev)} data-level-key="step-prev" />
                <span className="cn-stepper__at">{ts("messagePosition", { index: at + 1, total: entry.list.length })}</span>
                <Button label={ts("nextMessage")} icon="right" size="sm" disabled={!next} onClick={() => next && onStep(next)} data-level-key="step-next" />
              </div>
            ) : null}
            <KeyHints label={ts("keysLabel")} hints={hints} />
          </>
        }
      >
        <KitSurface density="calm">
          {m ? (
            <ChannelsNightLetter
              message={m}
              refs={refs}
              receipt={receipt}
              relayConfigured={feed.relayConfigured}
              onResent={() => feed.load()}
              onConfigureRelay={(el) => onOpenChannel("relay", el)}
            />
          ) : messages === null ? (
            <LoadingGap className="min-h-[12rem]" />
          ) : (
            <div className="cn-empty">
              <p>{ts("messageMissing")}</p>
              <p>{ts("messageMissingBody")}</p>
            </div>
          )}
        </KitSurface>
      </ChannelsNightFrame>
    </div>
  );
}
