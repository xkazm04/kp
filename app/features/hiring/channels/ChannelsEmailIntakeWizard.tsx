"use client";
/* eslint-disable i18next/no-literal-string -- prototype-stage copy; threaded into
   the channels namespace on a later i18n pass. */

import { useState } from "react";
import type { ReactNode } from "react";
import { Inbox, Plus } from "lucide-react";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { Defer } from "@/app/_components/ui/Defer";
import { BTN_PRIMARY } from "@/app/_components/ui/recipes";
import { useReceivers, isReceiverLive } from "./useChannelsReceivers";
import { ReceiverTable } from "./ChannelsReceiverTable";
import { AddReceiverModal } from "./ChannelsAddReceiverModal";
import { SetupGuide } from "./ChannelsSetupGuide";
import { CvSimCard } from "./ChannelsCvSimCard";
import { ChannelEmpty } from "./ChannelsEmpty";

// Guided-forwarding Email intake (Direction ①). Receivers are a compact table (one
// role inbox per row); "Add inbox" is a modal, so the pane is view-first. The
// selected row drives the shared client-specific Gmail/Outlook setup guide — the one
// rule that makes intake automatic thereafter. Backed by the existing inbound-token
// webhook; a production build swaps the demo address for a real inbound-email
// provider (Postmark/SendGrid) routing to the same token.

function parseAddress(token: string, base: string): string {
  let host = "inbound.kp.app";
  try {
    const h = new URL(base).hostname;
    if (h && !/^(localhost|127\.|0\.0\.0\.0|\[|::1)/.test(h)) host = `inbound.${h.replace(/^www\./, "")}`;
  } catch {
    /* keep the placeholder */
  }
  return `${token}@${host}`;
}

function emailSteps(client: string, addr: ReactNode): ReactNode[] {
  if (client === "gmail") {
    return [
      <>Open Gmail → <b className="text-ink">Settings ⚙ → See all settings → Forwarding and POP/IMAP</b>.</>,
      <>Click <b className="text-ink">Add a forwarding address</b>, paste {addr}, then <b className="text-ink">Next → Proceed</b>.</>,
      <>Gmail emails a <b className="text-ink">confirmation code</b> to that address — it arrives here as the first item in <b className="text-ink">Communications</b>. Enter it back in Gmail to confirm.</>,
      <>Create a <b className="text-ink">Filter</b> (e.g. <i>Subject contains “application”</i>) → <b className="text-ink">Forward it to</b> {addr}. Every matching email now flows in automatically.</>,
    ];
  }
  return [
    <>Open Outlook on the web → <b className="text-ink">Settings ⚙ → Mail → Rules → Add new rule</b>.</>,
    <>Name it <i>“Applications → KP”</i> and add a condition (e.g. <i>Subject includes “application”</i>).</>,
    <>Set the action to <b className="text-ink">Redirect to</b> (or <b className="text-ink">Forward to</b>) {addr}.</>,
    <>Click <b className="text-ink">Save</b>. Matching mail is now redirected automatically — no code to confirm.</>,
  ];
}

export function EmailIntakeWizard({ onChanged }: { onChanged?: () => void }) {
  const { receivers, jobs, load, revoke, revoking } = useReceivers("email", onChanged);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const base = publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "");
  const selected = receivers ? receivers.find((h) => h.token === selectedToken) ?? receivers[0] ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-xl text-sm text-steel">
          Forward applications from Outlook or Gmail — set <b className="text-ink">one rule per role</b> and every application flows into the pipeline automatically.
        </p>
        <button type="button" onClick={() => setAddOpen(true)} className={`${BTN_PRIMARY} h-9 shrink-0 px-3 text-sm`}>
          <Plus size={15} aria-hidden /> Add inbox
        </button>
      </div>

      {receivers === null ? (
        // Tier 2 (docs/LOADING_CHOREOGRAPHY.md): the receivers fetch hasn't settled
        // yet — hold the table's height and say nothing, rather than flashing the
        // "not connected" empty state below for what may well already be wired up.
        <div className="reveal-quiet min-h-[8rem]" aria-hidden />
      ) : receivers.length === 0 ? (
        // No receiver = no forwarding address exists = the mailbox link is genuinely
        // open. `connected` is false by construction here, never assumed.
        <ChannelEmpty
          section="email"
          connected={false}
          action={
            <button type="button" onClick={() => setAddOpen(true)} className={`${BTN_PRIMARY} h-9 px-3 text-sm`}>
              <Plus size={15} aria-hidden /> Add inbox
            </button>
          }
        />
      ) : (
        <div className="animate-arrive-in">
          <ReceiverTable
            receivers={receivers}
            endpointFor={(t) => parseAddress(t, base)}
            endpointLabel="Parse address"
            onRevoke={revoke}
            revoking={revoking}
            selectedToken={selected?.token}
            onSelect={setSelectedToken}
          />
        </div>
      )}

      {selected ? (
        <>
          {/* Tier 3: the setup guide is the next thing a recruiter reads after
              picking a row, so it commits a frame later rather than competing with
              the table's own paint; the CV simulator is a further-secondary action. */}
          <Defer strategy="next-frame">
            <SetupGuide
              endpoint={parseAddress(selected.token, base)}
              live={isReceiverLive(selected)}
              lead={
                <>
                  Forward <b className="text-ink">{selected.jobTitle ?? selected.jobId}</b> applications to
                </>
              }
              clients={[
                { value: "gmail", label: "Gmail" },
                { value: "outlook", label: "Outlook" },
              ]}
              stepsFor={emailSteps}
              waitingLabel="Waiting for the first forward…"
            />
          </Defer>
          <Defer strategy="idle">
            <CvSimCard jobId={selected.jobId} jobTitle={selected.jobTitle ?? selected.jobId} channel="email" onDone={onChanged} />
          </Defer>
        </>
      ) : null}

      {addOpen ? (
        <AddReceiverModal
          title="Add role inbox"
          channel="email"
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
