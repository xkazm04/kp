"use client";
/* eslint-disable i18next/no-literal-string -- prototype-stage copy; threaded into
   the channels namespace on a later i18n pass. */

import { useState } from "react";
import type { ReactNode } from "react";
import { Megaphone, Plus } from "lucide-react";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { Defer } from "@/app/_components/ui/Defer";
import { BTN_PRIMARY } from "@/app/_components/ui/recipes";
import { useReceivers, isReceiverLive } from "./useChannelsReceivers";
import { ReceiverTable } from "./ChannelsReceiverTable";
import { AddReceiverModal } from "./ChannelsAddReceiverModal";
import { SetupGuide } from "./ChannelsSetupGuide";
import { CvSimCard } from "./ChannelsCvSimCard";
import { ChannelEmpty } from "./ChannelsEmpty";

// Ad forms — lead-gen ad forms (LinkedIn / Meta) POST their leads at a role's
// receiver URL. Same view-first shape as Email intake: a compact table of receivers,
// "Add receiver" as a modal, and a selected-row setup guide — here the LinkedIn/Meta
// connector steps (Zapier/Make being the realistic bridge) rather than mail rules.
function adsSteps(client: string, url: ReactNode): ReactNode[] {
  if (client === "linkedin") {
    return [
      <>In <b className="text-ink">Zapier</b> or <b className="text-ink">Make</b>, create a flow: trigger <b className="text-ink">LinkedIn Lead Gen Forms → New Lead</b> (connect your ad account).</>,
      <>Add an action <b className="text-ink">Webhooks → POST</b> and set the URL to {url}.</>,
      <>Map the lead’s <b className="text-ink">name</b>, <b className="text-ink">email</b>, and résumé/CV file into the request body.</>,
      <>Turn it on — new LinkedIn leads now post into the pipeline automatically.</>,
    ];
  }
  return [
    <>In <b className="text-ink">Zapier</b> or <b className="text-ink">Make</b>, create a flow: trigger <b className="text-ink">Facebook Lead Ads → New Lead</b> (connect your Page).</>,
    <>Add an action <b className="text-ink">Webhooks → POST</b> and set the URL to {url}.</>,
    <>Map the lead’s <b className="text-ink">name</b>, <b className="text-ink">email</b>, and any CV upload field into the request body.</>,
    <>Turn it on — new Meta leads now post into the pipeline automatically.</>,
  ];
}

export function AdFormsPane({ onChanged }: { onChanged?: () => void }) {
  const { receivers, jobs, load, revoke, revoking } = useReceivers("boards", onChanged);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const base = publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "");
  const receiverUrl = (token: string) => `${base}/api/channels/inbound/${token}`;
  const selected = receivers ? receivers.find((h) => h.token === selectedToken) ?? receivers[0] ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-xl text-sm text-steel">
          Point a LinkedIn or Meta lead-gen ad form’s webhook at a role’s <b className="text-ink">receiver URL</b> — every lead lands in the pipeline automatically.
        </p>
        <button type="button" onClick={() => setAddOpen(true)} className={`${BTN_PRIMARY} h-9 shrink-0 px-3 text-sm`}>
          <Plus size={15} aria-hidden /> Add receiver
        </button>
      </div>

      {receivers === null ? (
        // Tier 2 (docs/LOADING_CHOREOGRAPHY.md): the receivers fetch hasn't settled
        // yet — hold the table's height and say nothing, rather than flashing the
        // "not connected" empty state below for what may well already be wired up.
        <div className="reveal-quiet min-h-[8rem]" aria-hidden />
      ) : receivers.length === 0 ? (
        // No receiver = no webhook URL exists yet, so nothing can be posting in.
        <ChannelEmpty
          section="ads"
          connected={false}
          action={
            <button type="button" onClick={() => setAddOpen(true)} className={`${BTN_PRIMARY} h-9 px-3 text-sm`}>
              <Plus size={15} aria-hidden /> Add receiver
            </button>
          }
        />
      ) : (
        <div className="animate-arrive-in">
          <ReceiverTable
            receivers={receivers}
            endpointFor={receiverUrl}
            endpointLabel="Receiver URL"
            onRevoke={revoke}
            revoking={revoking}
            selectedToken={selected?.token}
            onSelect={setSelectedToken}
          />
        </div>
      )}

      {selected ? (
        <>
          {/* Tier 3: the setup guide follows a beat after the table's own paint;
              the CV simulator is a further-secondary action. */}
          <Defer strategy="next-frame">
            <SetupGuide
              endpoint={receiverUrl(selected.token)}
              live={isReceiverLive(selected)}
              lead={
                <>
                  Point the <b className="text-ink">{selected.jobTitle ?? selected.jobId}</b> ad form at
                </>
              }
              clients={[
                { value: "linkedin", label: "LinkedIn" },
                { value: "meta", label: "Meta" },
              ]}
              stepsFor={adsSteps}
              waitingLabel="Waiting for the first lead…"
              footnote={
                <>
                  Advanced: skip the connector and POST leads to this URL directly — LinkedIn’s Lead Sync API, or a Meta app subscribed to the <code className="rounded bg-stone-100 px-1 text-ink">leadgen</code> webhook, can target it once verified.
                </>
              }
            />
          </Defer>
          <Defer strategy="idle">
            <CvSimCard jobId={selected.jobId} jobTitle={selected.jobTitle ?? selected.jobId} channel="boards" onDone={onChanged} />
          </Defer>
        </>
      ) : null}

      {addOpen ? (
        <AddReceiverModal
          title="Add ad-form receiver"
          channel="boards"
          jobs={jobs ?? []}
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
