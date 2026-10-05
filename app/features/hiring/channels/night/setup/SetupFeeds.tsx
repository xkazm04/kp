"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, KeyValueGrid, Note, Tag } from "@/app/_components/kit";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";
import type { useChannelData } from "../../useChannelsData";
import { NODE_NAME } from "../channelsNightCopy";
import type { NightChannel } from "../channelsNightNav";
import { FEED_CONDITION, FEED_STATE_KEY, feedState, rankFeeds } from "./setupModel";
import { SetupCard } from "./SetupBits";
import { SetupPullForm } from "./SetupPullForm";

/**
 * Pull feeds: every receiver's pull half (a pull source belongs to a receiver of any channel),
 * failing first, then set-but-never-pulled, pulling, push only. Each card states its source, the
 * bearer token (never shown), the last pull and the last error AS DATA (code-styled; the headline is
 * always the catalog sentence), the note its state owes, and opens its editor in place. With no
 * receiver at all it says where one is added. `focus` (a failing pull's need) opens that editor.
 */
export function SetupFeeds({ data, focus, onGo }: { data: ReturnType<typeof useChannelData>; focus: string | null; onGo: (channel: NightChannel) => void }) {
  const t = useTranslations();
  const tp = useTranslations("channels.pull");
  const ts = useTranslations("channelsNight.setup.feeds");
  const locale = useLocale();
  const fmt = useDateFormat();
  const [open, setOpen] = useState<string | null>(focus);
  const cards = useRef(new Map<string, HTMLElement>());
  const pending = useRef<string | null>(focus);
  const list = useMemo(() => (data.webhooks ? rankFeeds(data.webhooks, locale) : null), [data.webhooks, locale]);

  useEffect(() => {
    const el = pending.current ? cards.current.get(pending.current) : null;
    if (!el) return;
    el.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    pending.current = null;
  }, [list]);

  if (list === null) return <LoadingGap className="cns-hold" />;
  if (list.length === 0) {
    return (
      <div className="cns-body">
        <p className="cns-intro">{t("channelsNight.shell.feedsEmpty")}</p>
        <div className="cns-row">
          {(["email", "ads"] as const).map((c) => (
            <Button key={c} label={ts("goTo", { channel: t(NODE_NAME[c]) })} icon="right" onClick={() => onGo(c)} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="cns-body">
      {data.webhooksTruncated ? <Note tone="caution">{t("channels.receiversTruncated")}</Note> : null}
      <p className="cns-intro">{tp("intro")}</p>
      <ul className="cns-cards" aria-label={ts("listLabel")}>
        {list.map((w: ChannelWebhookRecord) => {
          const st = feedState(w);
          const isOpen = open === w.token;
          return (
            <SetupCard
              key={w.token}
              title={w.jobTitle ?? w.jobId}
              condition={FEED_CONDITION[st]}
              words={t(FEED_STATE_KEY[st])}
              tags={<Tag label={t(NODE_NAME[w.channel === "email" ? "email" : "ads"])} />}
              focus={w.token === focus}
              cardRef={(el) => {
                if (el) cards.current.set(w.token, el);
                else cards.current.delete(w.token);
              }}
            >
              {w.pullUrl ? (
                <KeyValueGrid
                  cols={2}
                  items={[
                    { label: tp("title"), value: <code>{w.pullUrl}</code> },
                    { label: tp("secretLabel"), value: w.hasPullSecret ? t("channelsNight.setup.secret.setHidden") : null, absent: t("channels.kit.notSet") },
                    { label: t("channels.kit.lastPull"), value: w.lastPullAt ? fmt.dateTime(w.lastPullAt) : null, absent: tp("neverPulled") },
                    { label: ts("lastError"), value: w.lastPullError ? <code>{w.lastPullError}</code> : null, absent: ts("noError") },
                  ]}
                />
              ) : null}
              {st === "fail" ? (
                <Note tone="critical">
                  {tp("failingTitle")} {tp("failingHint")}
                </Note>
              ) : st === "wait" ? (
                <p className="cns-help">{tp("neverPulled")}</p>
              ) : st === "off" ? (
                <p className="cns-help">{tp("pushOnly")}</p>
              ) : null}
              <div className="cns-row">
                <Button
                  label={isOpen ? ts("close") : w.pullUrl ? ts("edit") : ts("add")}
                  icon={isOpen ? "up" : "down"}
                  aria-expanded={isOpen}
                  variant={st === "fail" && !isOpen ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setOpen(isOpen ? null : w.token)}
                />
              </div>
              {isOpen ? <SetupPullForm receiver={w} onSaved={data.reload} /> : null}
            </SetupCard>
          );
        })}
      </ul>
    </div>
  );
}
