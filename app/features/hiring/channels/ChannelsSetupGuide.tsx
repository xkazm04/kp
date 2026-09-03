"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { AlertTriangle, Check, Copy, Radio } from "lucide-react";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { useCopyState } from "./useCopyState";

// The shared "connect this channel" guide: a status header (endpoint + live/waiting),
// a client picker (Gmail/Outlook, or LinkedIn/Meta), and the numbered steps for the
// chosen client. Used by both the Email intake and Ad forms panes so the guided
// experience reads identically; only the client set + step copy differ.
//
// channels-i18n-honesty: the guide's own chrome (copy button, "Setup for", the
// live/waiting status) resolves through `channels.*`; the caller supplies the
// already-localized lead-in, steps and waiting label for its channel.

export function CopyChip({ value }: { value: string }) {
  const t = useTranslations("channels");
  // A denied clipboard is VISIBLE here (useCopyState) — the chip's value is the
  // receiver endpoint the operator is about to paste into Gmail/Outlook or an ad
  // network, and the code beside the button is what they fall back to selecting.
  const { state, copy } = useCopyState();
  const failed = state === "failed";
  return (
    <span className="inline-flex items-center gap-1.5">
      <code className="rounded bg-stone-100 px-1.5 py-0.5 text-sm text-ink">{value}</code>
      <button
        type="button"
        onClick={() => copy(value)}
        aria-label={t("copy")}
        aria-live="polite"
        className={`focus-ring inline-flex items-center gap-1 rounded-md border bg-white px-1.5 py-0.5 text-xs font-semibold hover:border-coral/40 ${
          failed ? "border-red-300 text-red-700" : "border-stone-200 text-ink"
        }`}
      >
        {failed ? <AlertTriangle size={12} /> : state === "copied" ? <Check size={12} /> : <Copy size={12} />}{" "}
        {failed ? t("copyFailed") : state === "copied" ? t("copied") : t("copy")}
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
  liveLabel,
  waitingLabel,
  footnote,
}: {
  endpoint: string;
  live: boolean;
  /** The lead-in sentence before the endpoint chip, e.g. "Forward <b>Role</b> to". */
  lead: ReactNode;
  clients: GuideClient[];
  stepsFor: (client: string, endpointNode: ReactNode) => ReactNode[];
  liveLabel?: string;
  /** Channel-specific "nothing has arrived yet" line — required so the honest
   *  waiting state can never render blank. */
  waitingLabel: string;
  footnote?: ReactNode;
}) {
  const t = useTranslations("channels");
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
            <Radio size={14} aria-hidden /> {liveLabel ?? t("guide.live")}
          </span>
        ) : (
          <span className="text-sm text-steel">{waitingLabel}</span>
        )}
      </div>

      <div className="mt-3">
        <SegmentedControl label={t("guide.setupFor")} value={client} onChange={setClient} options={clients} />
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
