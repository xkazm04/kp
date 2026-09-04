"use client";

// Small shared widgets for the Channels tab stage: a copy-link button and a
// stat tile. Split out of ChannelsTab.tsx to keep the tab file under the
// 200-line cap.

import { useTranslations } from "next-intl";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { useCopyState } from "./useCopyState";

export function CopyLink({ url }: { url: string }) {
  const t = useTranslations("channels");
  // "clipboard blocked" used to be a comment in an empty catch — the recruiter saw
  // nothing at all and pasted whatever was already on their clipboard into a job ad.
  // useCopyState surfaces the denial and tells them to select the link instead.
  const { state, copy } = useCopyState();
  const failed = state === "failed";
  return (
    <button
      type="button"
      onClick={() => copy(url)}
      aria-live="polite"
      className={`focus-ring inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-xs font-semibold hover:border-coral/40 ${
        failed ? "border-red-300 text-red-700" : "border-stone-200 text-ink"
      }`}
    >
      {failed ? <AlertTriangle size={12} /> : state === "copied" ? <Check size={12} /> : <Copy size={12} />}{" "}
      {failed ? t("copyFailed") : state === "copied" ? t("copied") : t("copyLink")}
    </button>
  );
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    // PANEL + META_LABEL, not the re-typed strings this file carried as recipe debt:
    // the literal panel missed the recipe's dual-theme shape and the meta label was a
    // third copy of a string that has one definition. `shadow-pop` stays — the stat
    // cluster deliberately floats above the stage band.
    <div className={`${PANEL} px-3 py-1.5 shadow-pop`}>
      <div className={META_LABEL}>{label}</div>
      <div className="font-serif text-h3 leading-tight text-ink nums">{value}</div>
    </div>
  );
}
