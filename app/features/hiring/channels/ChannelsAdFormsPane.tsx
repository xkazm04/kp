"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Megaphone, Plus } from "lucide-react";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { BTN_PRIMARY } from "@/app/_components/ui/recipes";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";
import { useReceivers, isReceiverLive, type ReceiverJob } from "@/app/features/hiring/channels/useChannelsReceivers";
import { ReceiverTable } from "@/app/features/hiring/channels/ChannelsReceiverTable";
import { AddReceiverModal } from "@/app/features/hiring/channels/ChannelsAddReceiverModal";
import { SetupGuide } from "@/app/features/hiring/channels/ChannelsSetupGuide";
import { CvSimCard } from "@/app/features/hiring/channels/ChannelsCvSimCard";

// Ad forms — lead-gen ad forms (LinkedIn / Meta) POST their leads at a role's
// receiver URL. Same view-first shape as Email intake: a compact table of receivers,
// "Add receiver" as a modal, and a selected-row setup guide — here the LinkedIn/Meta
// connector steps (Zapier/Make being the realistic bridge) rather than mail rules.
// All copy resolves through the `channels.ads.*` catalog (channels-i18n-honesty).
export function AdFormsPane({
  webhooks,
  jobs,
  reload,
  onChanged,
}: {
  /** Passed down from the tab rather than re-fetched — see useChannelsReceivers. */
  webhooks: ChannelWebhookRecord[] | null;
  jobs: ReceiverJob[] | null;
  reload: () => void;
  onChanged?: () => void;
}) {
  const t = useTranslations("channels");
  const { receivers, load, revoke, revoking, revokeFailed } = useReceivers({ channel: "boards", webhooks, reload, onChanged });
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const base = publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "");
  const receiverUrl = (token: string) => `${base}/api/channels/inbound/${token}`;
  const list = receivers ?? [];
  // REFACTOR: null receivers = still loading, which must not flash the empty state.
  const selected = receivers ? receivers.find((h) => h.token === selectedToken) ?? receivers[0] ?? null : null;

  const bold = (chunks: ReactNode) => <b className="text-ink">{chunks}</b>;
  const adsSteps = (client: string, urlNode: ReactNode): ReactNode[] => {
    const keys = client === "linkedin" ? (["linkedin1", "linkedin2", "linkedin3", "linkedin4"] as const) : (["meta1", "meta2", "meta3", "meta4"] as const);
    return keys.map((k) => t.rich(`ads.${k}`, { b: bold, endpoint: () => urlNode }));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-xl text-sm text-steel">{t.rich("ads.intro", { b: bold })}</p>
        <button type="button" onClick={() => setAddOpen(true)} className={`${BTN_PRIMARY} h-9 shrink-0 px-3 text-sm`}>
          <Plus size={15} aria-hidden /> {t("ads.add")}
        </button>
      </div>

      {revokeFailed ? (
        <p role="alert" className="text-sm font-medium text-coral">
          {revokeFailed}
        </p>
      ) : null}

      {receivers && receivers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-paper/50 px-6 py-10 text-center">
          <Megaphone size={22} className="text-steel" aria-hidden />
          <p className="text-sm text-steel">{t("ads.empty")}</p>
        </div>
      ) : (
        <ReceiverTable
          receivers={list}
          endpointFor={receiverUrl}
          endpointLabel={t("ads.endpoint")}
          onRevoke={revoke}
          revoking={revoking}
          selectedToken={selected?.token}
          onSelect={setSelectedToken}
        />
      )}

      {selected ? (
        <>
          <SetupGuide
            endpoint={receiverUrl(selected.token)}
            live={isReceiverLive(selected)}
            lead={t.rich("ads.lead", { role: selected.jobTitle ?? selected.jobId, b: bold })}
            clients={[
              { value: "linkedin", label: "LinkedIn" },
              { value: "meta", label: "Meta" },
            ]}
            stepsFor={adsSteps}
            waitingLabel={t("ads.waiting")}
            footnote={t.rich("ads.footnote", {
              code: (chunks) => <code className="rounded bg-stone-100 px-1 text-ink">{chunks}</code>,
            })}
          />
          <CvSimCard jobId={selected.jobId} jobTitle={selected.jobTitle ?? selected.jobId} channel="boards" onDone={onChanged} />
        </>
      ) : null}

      {addOpen ? (
        <AddReceiverModal
          title={t("ads.title")}
          channel="boards"
          // Passed through UNFLATTENED: `jobs ?? []` made a failed/in-flight read
          // indistinguishable from a workspace with no published roles, and the modal
          // asserted the latter ("Publish a role first").
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
