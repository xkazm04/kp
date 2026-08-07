"use client";
/* eslint-disable i18next/no-literal-string -- prototype-stage copy; threaded into
   the channels namespace on a later i18n pass. */

import { useState } from "react";
import type { ReactNode } from "react";
import { Inbox, Plus } from "lucide-react";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { BTN_PRIMARY } from "@/app/_components/ui/recipes";
import { useReceivers, isReceiverLive } from "./use-receivers";
import { ReceiverTable, AddReceiverModal } from "./channel-receivers";
import { SetupGuide } from "./SetupGuide";
import { CvSimCard } from "./CvSimCard";

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
  const list = receivers ?? [];
  const selected = list.find((h) => h.token === selectedToken) ?? list[0] ?? null;

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

      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-paper/50 px-6 py-10 text-center">
          <Inbox size={22} className="text-steel" aria-hidden />
          <p className="text-sm text-steel">No role inboxes yet — add one to get a forwarding address.</p>
        </div>
      ) : (
        <ReceiverTable
          receivers={list}
          endpointFor={(t) => parseAddress(t, base)}
          endpointLabel="Parse address"
          onRevoke={revoke}
          revoking={revoking}
          selectedToken={selected?.token}
          onSelect={setSelectedToken}
        />
      )}

      {selected ? (
        <>
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
          <CvSimCard jobId={selected.jobId} jobTitle={selected.jobTitle ?? selected.jobId} channel="email" onDone={onChanged} />
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
