"use client";

// Small shared widgets for the Channels tab stage: a copy-link button and a
// stat tile. Split out of ChannelsTab.tsx to keep the tab file under the
// 200-line cap.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";

export function CopyLink({ url }: { url: string }) {
  const t = useTranslations("channels");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="focus-ring inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs font-semibold text-ink hover:border-coral/40"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? t("copied") : t("copyLink")}
    </button>
  );
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 shadow-pop">
      <div className="text-meta uppercase text-steel">{label}</div>
      <div className="font-serif text-h3 leading-tight text-ink nums">{value}</div>
    </div>
  );
}
