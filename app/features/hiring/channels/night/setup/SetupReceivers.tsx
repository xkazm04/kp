"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, Note } from "@/app/_components/kit";
import { ConfirmDialog } from "@/app/_components/ConfirmDialog";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { useCommsCapability } from "@/app/features/shell/useDeliveryCapability";
import type { useChannelData } from "../../useChannelsData";
import { isReceiverLive, useReceivers } from "../../useChannelsReceivers";
import { waitingReceivers } from "../../receiverWaiting";
import { useWaitingPoll } from "../../useWaitingPoll";
import { rankReceivers, receiverEndpoint, type ReceiverSection } from "./setupModel";
import { SetupAddReceiver } from "./SetupAddReceiver";
import { SetupReceiverCard } from "./SetupReceiverCard";

/**
 * Email intake / Ad forms: the section's receivers as cards, worst health first (rankReceivers).
 * Add opens in place; a new receiver is focused, scrolled to and its endpoint revealed once (it is
 * the moment it must be copied). Remove asks first (ConfirmDialog, a live receiver's traffic named)
 * and a refused revoke says why from its code. The level's `focus` (a need, a `?sec=email:<token>`
 * link) scrolls to that card. With no inbound mail domain, email says so above everything.
 */
export function SetupReceivers({ section, data, focus, onMessages }: {
  section: ReceiverSection;
  data: ReturnType<typeof useChannelData>;
  focus: string | null;
  onMessages: (role: string, el: HTMLElement) => void;
}) {
  const t = useTranslations("channels");
  const ts = useTranslations("channelsNight.setup.receivers");
  const locale = useLocale();
  const { emailInboundDomain } = useCommsCapability();
  const channel = section === "email" ? "email" : "boards";
  const { receivers, revoke, revoking, revokeFailed } = useReceivers({ channel, webhooks: data.webhooks, reload: data.reload });
  // A receiver nothing has reached yet re-reads the receivers list (and only that) on a
  // bounded poll, so it moves to Reached by itself; the poll ends with the last waiter.
  const now = useWaitingPoll(receivers ? waitingReceivers(receivers).length > 0 : false, data.reloadWebhooks);
  const [adding, setAdding] = useState(false);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const [fresh, setFresh] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ChannelWebhookRecord | null>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  // The card to scroll to once it exists: the level's focus, then a receiver just created.
  const pending = useRef<string | null>(focus);
  const base = publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "");
  const list = useMemo(() => (receivers ? rankReceivers(receivers, locale) : null), [receivers, locale]);

  const onReveal = useCallback((token: string, next: boolean) => {
    setRevealed((s) => {
      if (s.has(token) === next) return s;
      const out = new Set(s);
      if (next) out.add(token);
      else out.delete(token);
      return out;
    });
  }, []);

  useEffect(() => {
    const el = pending.current ? cards.current.get(pending.current) : null;
    if (!el) return;
    el.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    pending.current = null;
  }, [list]);

  const intro =
    section === "email" ? t.rich(emailInboundDomain ? "email.introWired" : "email.introUnwired", { b: (c) => <b>{c}</b> }) : t.rich("ads.intro", { b: (c) => <b>{c}</b> });
  const empty = section === "email" ? (emailInboundDomain ? t("email.emptyWired") : t("email.emptyUnwired")) : t("ads.empty");

  return (
    <div className="cns-body">
      {section === "email" && !emailInboundDomain ? (
        <Note tone="caution">
          <b>{t("email.notWiredTitle")}</b> {t("email.notWiredHowTo")}
        </Note>
      ) : null}
      {data.webhooksTruncated ? <Note tone="caution">{t("receiversTruncated")}</Note> : null}
      {revokeFailed ? <Note tone="critical">{revokeFailed}</Note> : null}
      <p className="cns-intro">{intro}</p>
      <div className="cns-row">
        <Button
          label={adding ? ts("addClose") : section === "email" ? t("email.add") : t("ads.add")}
          icon={adding ? "x" : "plus"}
          variant={adding ? "ghost" : "primary"}
          aria-expanded={adding}
          onClick={() => setAdding((a) => !a)}
        />
        <p className="cns-help">{list === null ? "" : list.length ? ts("count", { count: list.length }) : empty}</p>
      </div>
      {adding ? (
        <SetupAddReceiver
          channel={channel}
          jobs={data.jobs}
          onCreated={(token) => {
            setAdding(false);
            setFresh(token);
            pending.current = token;
            onReveal(token, true);
            data.reload();
          }}
        />
      ) : null}
      {list === null ? <LoadingGap className="cns-hold" /> : null}
      {list && list.length ? (
        <ul className="cns-cards" aria-label={section === "email" ? ts("listEmail") : ts("listAds")}>
          {list.map((w) => (
            <SetupReceiverCard
              key={w.token}
              receiver={w}
              section={section}
              endpoint={receiverEndpoint(w.token, section, emailInboundDomain, base)}
              revealed={revealed.has(w.token)}
              onReveal={onReveal}
              focus={w.token === focus || w.token === fresh}
              fresh={w.token === fresh}
              onRemove={setConfirm}
              removing={revoking === w.token}
              onMessages={onMessages}
              reload={data.reload}
              now={now}
              cardRef={(el) => {
                if (el) cards.current.set(w.token, el);
                else cards.current.delete(w.token);
              }}
            />
          ))}
        </ul>
      ) : null}
      {confirm ? (
        <ConfirmDialog
          title={t("receivers.confirmTitle")}
          confirmLabel={t("receivers.confirm")}
          cancelLabel={t("receivers.cancel")}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            void revoke(confirm.token);
            setConfirm(null);
          }}
        >
          {/* ConfirmDialog sets its body in a <p>: these are lines inside it, not paragraphs. */}
          <span className="cns-line">
            {t.rich("receivers.confirmBody", {
              role: confirm.jobTitle ?? confirm.jobId,
              endpoint: section === "email" ? (emailInboundDomain ? t("email.endpointWired") : t("email.endpointUnwired")) : t("ads.endpoint"),
              b: (c) => <b>{c}</b>,
            })}
          </span>
          {isReceiverLive(confirm) ? <span className="cns-line">{t("receivers.confirmLive", { count: confirm.receivedCount })}</span> : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
