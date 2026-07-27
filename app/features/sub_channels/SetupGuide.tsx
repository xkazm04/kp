"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Radio } from "lucide-react";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { SegmentedControl } from "@/app/_components/SegmentedControl";

// The shared "connect this channel" guide: a status header (endpoint + live/waiting),
// a client picker (Gmail/Outlook, or LinkedIn/Meta), and the numbered steps for the
// chosen client. Used by both the Email intake and Ad forms panes so the guided
// experience reads identically; only the client set + step copy differ.

export function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <code className="rounded bg-stone-100 px-1.5 py-0.5 text-sm text-ink">{value}</code>
      <button
        type="button"
        onClick={() =>
          navigator.clipboard
            .writeText(value)
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => undefined)
        }
        aria-label="Copy"
        className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-1.5 py-0.5 text-xs font-semibold text-ink hover:border-coral/40"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

export type GuideClient = { value: string; label: string };

export function SetupGuide({
  endpoint,
  live,
  lead,
  clients,
  stepsFor,
  liveLabel = "Receiving",
  waitingLabel = "Waiting for the first inbound…",
  footnote,
}: {
  endpoint: string;
  live: boolean;
  /** The lead-in sentence before the endpoint chip, e.g. "Forward <b>Role</b> to". */
  lead: ReactNode;
  clients: GuideClient[];
  stepsFor: (client: string, endpointNode: ReactNode) => ReactNode[];
  liveLabel?: string;
  waitingLabel?: string;
  footnote?: ReactNode;
}) {
  const reduced = useReducedMotion();
  const [client, setClient] = useState(clients[0]?.value ?? "");
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-steel">
          {lead} <CopyChip value={endpoint} />
        </p>
        {live ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-moss">
            <Radio size={14} aria-hidden /> {liveLabel}
          </span>
        ) : (
          <span className="text-sm text-steel">{waitingLabel}</span>
        )}
      </div>

      <div className="mt-3">
        <SegmentedControl label="Setup for" value={client} onChange={setClient} options={clients} />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.ol
          key={client}
          initial={reduced ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 1 } : { opacity: 0, y: -4 }}
          transition={reduced ? { duration: 0 } : { duration: 0.16, ease: "easeOut" }}
          className="mt-3 space-y-2.5"
        >
          {stepsFor(client, <code className="rounded bg-stone-100 px-1.5 py-0.5 text-sm text-ink">{endpoint}</code>).map((node, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-0.5 inline-grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-white">{i + 1}</span>
              <span className="text-sm leading-6 text-steel">{node}</span>
            </li>
          ))}
        </motion.ol>
      </AnimatePresence>

      {footnote ? <p className="mt-3 border-t border-stone-100 pt-2 text-xs text-steel">{footnote}</p> : null}
    </div>
  );
}
