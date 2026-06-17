"use client";

import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

// Candidate-facing transparency note. Our differentiator vs. opaque AI-hiring
// vendors: AI assists, a human decides, and assessment is on talent/fit.
// `showDataConsent` adds the GDPR data-processing + retention statement — passed
// only by the apply surfaces, where submitting IS the consent that's recorded
// (recordEntryConsent) with a 12-month expiry and a self-service erasure link.
export function AiDisclosure({
  className = "",
  showDataConsent = false,
}: {
  className?: string;
  showDataConsent?: boolean;
}) {
  const t = useTranslations("aiDisclosure");
  return (
    <div className={`rounded-md border border-stone-200 bg-paper/60 p-3 text-sm text-steel ${className}`}>
      <p className="flex items-center gap-1.5 font-semibold text-ink">
        <ShieldCheck size={14} className="text-moss" /> {t("title")}
      </p>
      <p className="mt-1">
        {t.rich("body", {
          highlight: (chunks) => <span className="font-medium text-ink">{chunks}</span>,
        })}
      </p>
      {showDataConsent ? <p className="mt-2 text-meta text-steel">{t("dataConsent")}</p> : null}
    </div>
  );
}
