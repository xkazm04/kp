"use client";

import { Check, Copy } from "lucide-react";
import type { useTranslations } from "next-intl";
import { BEATS, HOOK_LABEL_KEY, isHookType, type Variant } from "./jobsCampaignTabTypes";

// One ad-copy + video-script variant card — extracted verbatim from
// JobsCampaignTab.tsx so that file stays under the 200-line split threshold.
export function JobsCampaignTabVariantCard({
  v,
  i,
  copied,
  copyText,
  t,
}: {
  v: Variant;
  i: number;
  copied: string | null;
  copyText: (key: string, text: string) => void;
  t: ReturnType<typeof useTranslations<"jobs.campaign">>;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-micro font-semibold uppercase text-steel">
            {isHookType(v.hookType) ? t(HOOK_LABEL_KEY[v.hookType]) : v.hookType}
          </span>
          <p className="mt-1.5 font-serif text-h3 text-ink">{v.hook}</p>
        </div>
        <button
          type="button"
          onClick={() => copyText(`v${i}`, v.adCopy)}
          className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-md border border-stone-200 px-2.5 py-1 text-sm font-semibold text-ink hover:border-coral/40"
        >
          {copied === `v${i}` ? <Check size={13} /> : <Copy size={13} />}{" "}
          {copied === `v${i}` ? t("copied") : t("copy")}
        </button>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-base text-ink">{v.adCopy}</p>
      <div className="mt-3 rounded-md bg-paper/60 p-2.5">
        <p className="text-meta uppercase text-steel">{t("scriptTitle")}</p>
        <dl className="mt-1.5 space-y-1">
          {BEATS.map(([beat, key]) => (
            <div key={beat} className="grid grid-cols-[7.5rem_1fr] gap-2 text-sm">
              <dt className="font-semibold text-steel">{t(key)}</dt>
              <dd className="text-ink">{v.videoScript?.[beat] ?? ""}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* E5 — this variant's OWN &v= apply link, surfaced (not only
          buried inside the ad body) so copying it here keeps
          attribution. Absent on pre-E5 packs → no row. */}
      {v.applyUrl ? (
        <div className="mt-3 flex items-center gap-2">
          <div className="min-w-0">
            <p className="text-meta uppercase text-steel">{t("trackedLink")}</p>
            <p className="truncate font-mono text-sm text-coral" title={v.applyUrl}>
              {v.applyUrl}
            </p>
          </div>
          <button
            type="button"
            onClick={() => copyText(`url${i}`, v.applyUrl!)}
            className="focus-ring ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-stone-200 px-2.5 py-1 text-sm font-semibold text-ink hover:border-coral/40"
          >
            {copied === `url${i}` ? <Check size={13} /> : <Copy size={13} />}{" "}
            {copied === `url${i}` ? t("copied") : t("copyLink")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
