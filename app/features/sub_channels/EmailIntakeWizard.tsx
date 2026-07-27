"use client";
/* eslint-disable i18next/no-literal-string -- prototype-stage copy; threaded into
   the channels namespace on a later i18n pass. */

import { useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Plus } from "lucide-react";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { BTN_PRIMARY } from "@/app/_components/ui/recipes";
import { useCommsCapability } from "@/app/features/useDeliveryCapability";
import { useReceivers, isReceiverLive } from "./use-receivers";
import { ReceiverTable, AddReceiverModal } from "./channel-receivers";
import { SetupGuide, CopyChip } from "./SetupGuide";
import { CvSimCard } from "./CvSimCard";

// Guided-forwarding Email intake (Direction ①). Receivers are a compact table (one
// role inbox per row); "Add inbox" is a modal, so the pane is view-first. The
// selected row drives the shared client-specific Gmail/Outlook setup guide — the one
// rule that makes intake automatic thereafter.
//
// INBOUND-SETUP-HONESTY. This pane used to SYNTHESIZE a forwarding address from
// window.location (`<token>@inbound.<host>`, falling back to the literal
// `inbound.kp.app`) and walk the recruiter through pointing a real Gmail rule at it —
// but no inbound-email provider and no MX route exists anywhere in the repo. The only
// real receiver is the HTTP endpoint /api/channels/inbound/[token], so every
// application forwarded to that invented mailbox vanished, and the promised Gmail
// confirmation code could never "arrive here".
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

function emailSteps(client: string, addr: ReactNode): ReactNode[] {
  if (client === "gmail") {
    return [
      <>Open Gmail → <b className="text-ink">Settings ⚙ → See all settings → Forwarding and POP/IMAP</b>.</>,
      <>Click <b className="text-ink">Add a forwarding address</b>, paste {addr}, then <b className="text-ink">Next → Proceed</b>.</>,
      // Honest about WHERE the code shows up: it is mail addressed to the inbound
      // provider, not an application, so it never becomes a row in Communications
      // (which logs OUTBOUND messages only).
      <>Gmail emails a <b className="text-ink">confirmation code</b> to that address. Retrieve it from your inbound-email provider’s log — kp records outgoing messages, not the provider’s own mail — then enter it back in Gmail to confirm.</>,
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

// The keyless state: no invented mailbox, no forwarding steps, no confirmation-code
// promise — just the receiver that genuinely exists and what it would take to wire
// forwarding on top of it.
function ForwardingNotWired({ receiverUrl, role }: { receiverUrl: string; role: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
      <p className="flex items-start gap-2 text-sm font-semibold text-amber-900">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
        Email forwarding isn’t wired yet — there is no mailbox to forward to.
      </p>
      <p className="mt-2 text-sm text-steel">
        This deployment has no inbound-email provider, so a Gmail or Outlook rule would send{" "}
        <b className="text-ink">{role}</b> applications to an address that accepts nothing. The real receiver is an
        HTTP endpoint:
      </p>
      <p className="mt-2 text-sm text-steel">
        <CopyChip value={receiverUrl} />
      </p>
      <p className="mt-2 text-sm text-steel">
        Anything that can POST will reach it today — an automation (Zapier/Make), a form, or a mail-parsing service.
        To turn on real forwarding, route an inbound-email provider (Postmark, SendGrid or Mailgun inbound) at this
        endpoint and set <code className="rounded bg-stone-100 px-1 text-ink">EMAIL_INBOUND_DOMAIN</code> to the
        domain it accepts mail on. The forwarding address and the Gmail/Outlook steps appear here once it’s set.
      </p>
    </div>
  );
}

export function EmailIntakeWizard({ onChanged }: { onChanged?: () => void }) {
  const { receivers, jobs, load, revoke, revoking } = useReceivers("email", onChanged);
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
  const endpointLabel = emailInboundDomain ? "Forwarding address" : "Receiver URL";

  const list = receivers ?? [];
  const selected = list.find((h) => h.token === selectedToken) ?? list[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-xl text-sm text-steel">
          {emailInboundDomain ? (
            <>
              Forward applications from Outlook or Gmail — set <b className="text-ink">one rule per role</b> and every
              application flows into the pipeline automatically.
            </>
          ) : (
            <>
              One receiver per role. Email forwarding isn’t wired on this deployment, so each role’s receiver is an{" "}
              <b className="text-ink">HTTP endpoint</b> anything can POST an application to.
            </>
          )}
        </p>
        <button type="button" onClick={() => setAddOpen(true)} className={`${BTN_PRIMARY} h-9 shrink-0 px-3 text-sm`}>
          <Plus size={15} aria-hidden /> Add inbox
        </button>
      </div>

      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-paper/50 px-6 py-10 text-center">
          <Inbox size={22} className="text-steel" aria-hidden />
          <p className="text-sm text-steel">
            {emailInboundDomain
              ? "No role inboxes yet — add one to get a forwarding address."
              : "No role inboxes yet — add one to get its receiver URL."}
          </p>
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
          ) : (
            <ForwardingNotWired receiverUrl={receiverUrl(selected.token)} role={selected.jobTitle ?? selected.jobId} />
          )}
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
