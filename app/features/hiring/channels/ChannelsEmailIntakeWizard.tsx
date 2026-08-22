"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Inbox, Plus } from "lucide-react";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { BTN_PRIMARY } from "@/app/_components/ui/recipes";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";
import { useCommsCapability } from "@/app/features/shell/useDeliveryCapability";
import { useReceivers, isReceiverLive, type ReceiverJob } from "@/app/features/hiring/channels/useChannelsReceivers";
import { ReceiverTable } from "@/app/features/hiring/channels/ChannelsReceiverTable";
import { AddReceiverModal } from "@/app/features/hiring/channels/ChannelsAddReceiverModal";
import { SetupGuide, CopyChip } from "@/app/features/hiring/channels/ChannelsSetupGuide";
import { CvSimCard } from "@/app/features/hiring/channels/ChannelsCvSimCard";

// Guided-forwarding Email intake (Direction ①). Receivers are a compact table (one
// role inbox per row); "Add inbox" is a modal, so the pane is view-first. The
// selected row drives the shared client-specific Gmail/Outlook setup guide — the one
// rule that makes intake automatic thereafter.
//
// INBOUND-SETUP-HONESTY. This pane used to SYNTHESIZE a forwarding address from
// window.location (`<token>@inbound.<host>`, falling back to the literal
// `inbound.kp.app`) although no inbound-email provider and no MX route exists anywhere
// in the repo. The only real receiver is the HTTP endpoint
// /api/channels/inbound/[token], so every application forwarded to that invented
// mailbox vanished, and the promised Gmail confirmation code could never "arrive here".
//
// A mail route is a DEPLOYMENT FACT, so it is a capability bit, not a derivation:
// EMAIL_INBOUND_DOMAIN → comms-truth.emailInboundDomain() → /api/comms/capability →
// useCommsCapability (the same bit-serving path isRelayConfigured/useDeliveryCapability
// already use). Unset ⇒ the pane shows the real HTTP receiver and says forwarding
// isn't wired; set ⇒ the address is derived from the configured domain, never from the
// browser's location.

function forwardingAddress(token: string, domain: string): string {
  return `${token}@${domain}`;
}

// The keyless state: no invented mailbox, no forwarding steps, no confirmation-code
// promise — just the receiver that genuinely exists and what it would take to wire
// forwarding on top of it.
function ForwardingNotWired({ receiverUrl, role }: { receiverUrl: string; role: string }) {
  const t = useTranslations("channels");
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
      <p className="flex items-start gap-2 text-sm font-semibold text-amber-900">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
        {t("email.notWiredTitle")}
      </p>
      <p className="mt-2 text-sm text-steel">
        {t.rich("email.notWiredBody", { role, b: (chunks) => <b className="text-ink">{chunks}</b> })}
      </p>
      <p className="mt-2 text-sm text-steel">
        <CopyChip value={receiverUrl} />
      </p>
      <p className="mt-2 text-sm text-steel">{t("email.notWiredHowTo")}</p>
      <p className="mt-2 text-sm text-steel">
        {t.rich("email.notWiredHowToSetup", {
          code: (chunks) => <code className="rounded bg-stone-100 px-1 text-ink">{chunks}</code>,
        })}
      </p>
    </div>
  );
}

export function EmailIntakeWizard({
  webhooks,
  jobs,
  reload,
  onChanged,
}: {
  /** The tab's receivers list (null while its first fetch is in flight) and its
   *  published-jobs list, both passed down rather than re-fetched here. */
  webhooks: ChannelWebhookRecord[] | null;
  jobs: ReceiverJob[] | null;
  reload: () => void;
  onChanged?: () => void;
}) {
  const t = useTranslations("channels");
  const { receivers, load, revoke, revoking, revokeFailed } = useReceivers({ channel: "email", webhooks, reload, onChanged });
  const { emailInboundDomain } = useCommsCapability();
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const base = publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "");
  const receiverUrl = (token: string) => `${base}/api/channels/inbound/${token}`;
  // The endpoint a row shows is whichever one is REAL: the forwarding address only
  // when a domain is configured, otherwise the HTTP receiver.
  const endpointFor = emailInboundDomain
    ? (token: string) => forwardingAddress(token, emailInboundDomain)
    : receiverUrl;
  const endpointLabel = emailInboundDomain ? t("email.endpointWired") : t("email.endpointUnwired");

  const list = receivers ?? [];
  // REFACTOR: null receivers = still loading, which must not flash the empty state.
  const selected = receivers ? receivers.find((h) => h.token === selectedToken) ?? receivers[0] ?? null : null;

  const bold = (chunks: ReactNode) => <b className="text-ink">{chunks}</b>;
  const italic = (chunks: ReactNode) => <i>{chunks}</i>;
  const emailSteps = (client: string, endpointNode: ReactNode): ReactNode[] => {
    const keys = client === "gmail" ? (["gmail1", "gmail2", "gmail3", "gmail4"] as const) : (["outlook1", "outlook2", "outlook3", "outlook4"] as const);
    return keys.map((k) => t.rich(`email.${k}`, { b: bold, i: italic, endpoint: () => endpointNode }));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-xl text-sm text-steel">
          {t.rich(emailInboundDomain ? "email.introWired" : "email.introUnwired", { b: bold })}
        </p>
        <button type="button" onClick={() => setAddOpen(true)} className={`${BTN_PRIMARY} h-9 shrink-0 px-3 text-sm`}>
          <Plus size={15} aria-hidden /> {t("email.add")}
        </button>
      </div>

      {revokeFailed ? (
        <p role="alert" className="text-sm font-medium text-coral">
          {t("add.removeFailed")}
        </p>
      ) : null}

      {receivers && receivers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-paper/50 px-6 py-10 text-center">
          <Inbox size={22} className="text-steel" aria-hidden />
          <p className="text-sm text-steel">{emailInboundDomain ? t("email.emptyWired") : t("email.emptyUnwired")}</p>
        </div>
      ) : (
        <ReceiverTable
          receivers={list}
          endpointFor={endpointFor}
          endpointLabel={endpointLabel}
          onRevoke={revoke}
          revoking={revoking}
          selectedToken={selected?.token}
          onSelect={setSelectedToken}
        />
      )}

      {selected ? (
        <>
          {emailInboundDomain ? (
            <SetupGuide
              endpoint={forwardingAddress(selected.token, emailInboundDomain)}
              live={isReceiverLive(selected)}
              lead={t.rich("email.lead", { role: selected.jobTitle ?? selected.jobId, b: bold })}
              clients={[
                { value: "gmail", label: "Gmail" },
                { value: "outlook", label: "Outlook" },
              ]}
              stepsFor={emailSteps}
              waitingLabel={t("email.waiting")}
            />
          ) : (
            <ForwardingNotWired receiverUrl={receiverUrl(selected.token)} role={selected.jobTitle ?? selected.jobId} />
          )}
          <CvSimCard jobId={selected.jobId} jobTitle={selected.jobTitle ?? selected.jobId} channel="email" onDone={onChanged} />
        </>
      ) : null}

      {addOpen ? (
        <AddReceiverModal
          title={t("email.title")}
          channel="email"
          // Passed through UNFLATTENED — see AddReceiverModal's `jobs` prop: an
          // unread list must not be narrated as "no published roles".
          jobs={jobs}
          onClose={() => setAddOpen(false)}
          onCreated={(token) => {
            load();
            onChanged?.();
            if (token) setSelectedToken(token);
          }}
        />
      ) : null}
    </div>
  );
}
