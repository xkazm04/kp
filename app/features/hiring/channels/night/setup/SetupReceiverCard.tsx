"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, KeyValueGrid, Note, Tag, formatCount } from "@/app/_components/kit";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { DEFAULT_LOCALE } from "@/i18n/locales";
import { receiverHealth } from "../../receiverHealth";
import { RECEIVER_CONDITION, type Endpoint, type ReceiverSection } from "./setupModel";
import { SetupCard } from "./SetupBits";
import { SetupCvSim } from "./SetupCvSim";
import { SetupEndpoint } from "./SetupEndpoint";
import { SetupGuideSteps } from "./SetupGuideSteps";
import { SetupPullForm } from "./SetupPullForm";

type Panel = "steps" | "cv" | "pull" | null;

/**
 * One receiver (a role's inbox or ad-form webhook) as a card: its health in shape and words
 * (receiverHealth), the traffic that proves it (received is connectivity, accepted is candidates
 * filed, with that difference as the tip on "Leads filed"; a receiver never reached shows "—" with that
 * reason, not 0), first received, its pull half (source + last pull, or push only), the note its health owes
 * (a failing pull with its raw error as code, reached-but-empty, waiting), its endpoint masked
 * until revealed, and one open panel at a time: the setup steps, a real-CV test, the pull source.
 */
export function SetupReceiverCard({ receiver: w, section, endpoint, revealed, onReveal, focus, fresh, onRemove, removing, onMessages, reload, cardRef }: {
  receiver: ChannelWebhookRecord;
  section: ReceiverSection;
  endpoint: Endpoint;
  revealed: boolean;
  onReveal: (token: string, next: boolean) => void;
  focus: boolean;
  fresh: boolean;
  onRemove: (w: ChannelWebhookRecord) => void;
  removing: boolean;
  onMessages: (role: string, el: HTMLElement) => void;
  reload: () => void;
  cardRef: (el: HTMLElement | null) => void;
}) {
  const t = useTranslations("channels");
  const ts = useTranslations("channelsNight.setup.receiver");
  const tu = useTranslations("kit");
  const locale = useLocale();
  const fmt = useDateFormat();
  const rel = useRelativeTime();
  const [panel, setPanel] = useState<Panel>(null);
  const h = receiverHealth(w);
  const role = w.jobTitle ?? w.jobId;
  const reached = w.receivedCount > 0;
  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));
  const label = section === "email" ? (endpoint.wired ? t("email.endpointWired") : t("email.endpointUnwired")) : t("ads.endpoint");

  return (
    <SetupCard title={role} condition={RECEIVER_CONDITION[h.verdict]} words={t(h.key)} tags={<Tag label={(w.lang ?? DEFAULT_LOCALE).toUpperCase()} />} focus={focus} fresh={fresh} cardRef={cardRef}>
      <KeyValueGrid
        cols={4}
        items={[
          { label: t("stats.received"), value: reached ? formatCount(w.receivedCount, locale) : null, absent: t("kit.neverReached") },
          {
            label: t("stats.leads"),
            value: reached ? <span data-tip={ts("acceptedHint")} tabIndex={0}>{`${formatCount(w.acceptedCount, locale)} ${tu("of", { total: w.receivedCount })}`}</span> : null,
            absent: t("kit.neverReached"),
          },
          { label: ts("firstReceived"), value: w.firstReceivedAt ? fmt.date(w.firstReceivedAt) : null, absent: t("kit.neverReached") },
          { label: t("receivers.firstLead"), value: w.firstAcceptedAt ? fmt.date(w.firstAcceptedAt) : null, absent: t("kit.noLeadYet") },
          { label: t("kit.lastReceived"), value: w.lastReceivedAt ? rel(w.lastReceivedAt) : null, absent: t("kit.neverReached") },
          // The pull half, as SetupFeeds states it: a source and its last pull, or push only.
          { label: t("pull.title"), value: w.pullUrl ? <code className="k-code">{w.pullUrl}</code> : t("pull.statusOff") },
          ...(w.pullUrl ? [{ label: t("kit.lastPull"), value: w.lastPullAt ? fmt.dateTime(w.lastPullAt) : null, absent: t("pull.neverPulled") }] : []),
        ]}
      />
      {h.verdict === "pullFailing" ? (
        <Note tone="critical">
          {t("pull.failingTitle")} {h.detail ? <code className="k-code">{h.detail}</code> : null} {t("pull.failingHint")}
        </Note>
      ) : h.verdict === "reachedNoLeads" ? (
        <Note tone="caution">{ts("reachNote")}</Note>
      ) : h.verdict === "waiting" ? (
        <p className="cns-help">{ts("waitingNote")}</p>
      ) : null}
      <SetupEndpoint label={label} role={role} value={endpoint.value} masked={endpoint.masked} revealed={revealed} onReveal={(next) => onReveal(w.token, next)} />
      {fresh ? <p className="cns-help cns-help--once">{ts("newNote")}</p> : null}
      <div className="cns-row">
        <Button label={panel === "steps" ? ts("stepsHide") : ts("steps")} icon={panel === "steps" ? "up" : "down"} aria-expanded={panel === "steps"} size="sm" onClick={() => toggle("steps")} />
        <Button label={panel === "cv" ? ts("cvHide") : t("cvSim.open")} icon={panel === "cv" ? "up" : "down"} aria-expanded={panel === "cv"} size="sm" onClick={() => toggle("cv")} />
        <Button label={panel === "pull" ? ts("pullHide") : t("pull.title")} icon={panel === "pull" ? "up" : "down"} aria-expanded={panel === "pull"} size="sm" onClick={() => toggle("pull")} />
        <Button label={ts("messages")} icon="right" variant="ghost" size="sm" onClick={(e) => onMessages(role, e.currentTarget)} />
        <Button label={ts("remove")} aria-label={t("receivers.removeAria", { role })} icon="trash" variant="ghost" size="sm" disabled={removing} onClick={() => onRemove(w)} />
      </div>
      {panel === "steps" ? (
        <div className="cns-panel">
          <SetupGuideSteps section={section} role={role} endpoint={endpoint} revealed={revealed} live={h.live} />
        </div>
      ) : panel === "cv" ? (
        <SetupCvSim jobId={w.jobId} channel={w.channel} onDone={reload} />
      ) : panel === "pull" ? (
        <SetupPullForm receiver={w} onSaved={reload} />
      ) : null}
    </SetupCard>
  );
}
