"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { KeyValueGrid, Note, Section, formatCount } from "@/app/_components/kit";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";
import { useCommsCapability } from "@/app/features/shell/useDeliveryCapability";
import { SetupGuide } from "../ChannelsSetupGuide";
import { ReceiverPullCard } from "../ChannelsReceiverPullCard";
import { isReceiverLive } from "../useChannelsReceivers";

/**
 * One receiver as a document: its health figures, the pull failure when there is one, the
 * setup guide (the current tab's SetupGuide, per client) and the pull source editor (the
 * current tab's ReceiverPullCard). The guide and editor are reused as-is, not re-drawn.
 */
export function ChannelsKitReceiverPane({ receiver: w, section, reload }: {
  receiver: ChannelWebhookRecord;
  section: "email" | "ads";
  reload: () => void;
}) {
  const t = useTranslations("channels");
  const tk = useTranslations("channels.kit");
  const tu = useTranslations("kit");
  const locale = useLocale();
  const fmt = useDateFormat();
  const { emailInboundDomain } = useCommsCapability();
  const base = publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "");
  const role = w.jobTitle ?? w.jobId;
  const bold = (c: ReactNode) => <b>{c}</b>;
  const receiverUrl = `${base}/api/channels/inbound/${w.token}`;
  const wired = section === "ads" || Boolean(emailInboundDomain);
  const endpoint = section === "email" && emailInboundDomain ? `${w.token}@${emailInboundDomain}` : receiverUrl;
  const stepsFor = (client: string, node: ReactNode): ReactNode[] => {
    if (section === "email") {
      const keys = client === "gmail" ? (["gmail1", "gmail2", "gmail3", "gmail4"] as const) : (["outlook1", "outlook2", "outlook3", "outlook4"] as const);
      return keys.map((k) => t.rich(`email.${k}`, { b: bold, i: (c) => <i>{c}</i>, endpoint: () => node }));
    }
    const keys = client === "linkedin" ? (["linkedin1", "linkedin2", "linkedin3", "linkedin4"] as const) : (["meta1", "meta2", "meta3", "meta4"] as const);
    return keys.map((k) => t.rich(`ads.${k}`, { b: bold, endpoint: () => node }));
  };
  const reached = w.receivedCount > 0;

  return (
    <>
      <h3>{role}</h3>
      <p className="k-margin__sub">
        {t("guide.setupFor")} {"·"} {(w.lang ?? "").toUpperCase()}
      </p>
      {w.pullUrl && w.lastPullError ? (
        <Note tone="critical">
          {t("pull.failingTitle")} <code className="k-code">{w.lastPullError}</code>
        </Note>
      ) : null}
      <Section title={tk("health")}>
        <KeyValueGrid
          items={[
            { label: t("stats.received"), value: reached ? formatCount(w.receivedCount, locale) : null, absent: tk("neverReached") },
            { label: t("stats.leads"), value: reached ? `${formatCount(w.acceptedCount, locale)} ${tu("of", { total: w.receivedCount })}` : null, absent: tk("neverReached") },
            { label: tk("firstReceived"), value: w.firstReceivedAt ? fmt.date(w.firstReceivedAt) : null, absent: tk("neverReached") },
            { label: t("receivers.firstLead"), value: w.firstAcceptedAt ? fmt.date(w.firstAcceptedAt) : null, absent: tk("noLeadYet") },
            { label: t("pull.title"), value: w.pullUrl ? <code>{w.pullUrl}</code> : null, absent: t("pull.statusOff") },
            { label: tk("lastPull"), value: w.lastPullAt ? fmt.dateTime(w.lastPullAt) : null, absent: t("pull.statusOff") },
          ]}
        />
      </Section>
      <Section title={tk("setup")}>
        {wired ? (
          <SetupGuide
            endpoint={endpoint}
            live={isReceiverLive(w)}
            lead={t.rich(section === "email" ? "email.lead" : "ads.lead", { role, b: bold })}
            clients={section === "email" ? [{ value: "gmail", label: "Gmail" }, { value: "outlook", label: "Outlook" }] : [{ value: "linkedin", label: "LinkedIn" }, { value: "meta", label: "Meta" }]}
            stepsFor={stepsFor}
            waitingLabel={section === "email" ? t("email.waiting") : t("ads.waiting")}
          />
        ) : (
          <Note tone="caution">
            {t("email.notWiredTitle")} {t("email.notWiredHowTo")}
          </Note>
        )}
      </Section>
      <Section title={t("pull.title")}>
        <ReceiverPullCard key={w.token} receiver={w} onSaved={reload} />
      </Section>
    </>
  );
}
