"use client";
/* eslint-disable i18next/no-literal-string -- prototype-stage copy; threaded into
   the channels namespace on a later i18n pass. */

import { useState } from "react";
import type { ReactNode } from "react";
import { Megaphone, Plus } from "lucide-react";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { BTN_PRIMARY } from "@/app/_components/ui/recipes";
import { useReceivers, isReceiverLive } from "./use-receivers";
import { ReceiverTable, AddReceiverModal } from "./channel-receivers";
import { SetupGuide } from "./SetupGuide";
import { CvSimCard } from "./CvSimCard";

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
  const list = receivers ?? [];
  const selected = list.find((h) => h.token === selectedToken) ?? list[0] ?? null;

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

      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-paper/50 px-6 py-10 text-center">
          <Megaphone size={22} className="text-steel" aria-hidden />
          <p className="text-sm text-steel">No ad-form receivers yet — add one to get a webhook URL.</p>
        </div>
      ) : (
        <ReceiverTable
          receivers={list}
          endpointFor={receiverUrl}
          endpointLabel="Receiver URL"
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
          <CvSimCard jobId={selected.jobId} jobTitle={selected.jobTitle ?? selected.jobId} channel="boards" onDone={onChanged} />
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
