"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { DEFAULT_REGIME_ID, getRegime, type RegimeId } from "@/app/_lib/compliance-regimes";

// Candidate-facing transparency note. Our differentiator vs. opaque AI-hiring
// vendors: AI assists, a human decides, and assessment is on talent/fit.
// `showDataConsent` adds the data-processing + retention statement — passed only
// by the apply surfaces, where submitting IS the consent that's recorded
// (recordEntryConsent) with a 12-month expiry and a self-service erasure link.
//
// P1-1 — the note is JURISDICTION-AWARE. It self-resolves the workspace's active
// compliance regime from the public GET /api/compliance (this is a client
// component on public pages, so it can't read the DB directly) and names that
// regime's anti-discrimination framework + data law. Defaults to "eu" until the
// fetch lands, which reproduces the app's prior GDPR framing — so there's never a
// flash of WRONG content, only an accurate regime line that appears.
export function AiDisclosure({
  className = "",
  showDataConsent = false,
}: {
  className?: string;
  showDataConsent?: boolean;
}) {
  const t = useTranslations("aiDisclosure");
  const [regimeId, setRegimeId] = useState<RegimeId>(DEFAULT_REGIME_ID);

  useEffect(() => {
    let alive = true;
    fetch("/api/compliance")
      .then((r) => r.json())
      .then((d: { jurisdiction?: unknown }) => {
        if (alive && typeof d?.jurisdiction === "string") setRegimeId(d.jurisdiction as RegimeId);
      })
      .catch(() => {
        /* keep the default regime — the universal body still stands */
      });
    return () => {
      alive = false;
    };
  }, []);

  const regime = getRegime(regimeId);

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
      <p className="mt-2 text-meta text-steel">
        {t("regimeNote", { framework: regime.antiDiscrimination, dataLaw: regime.dataLaw })}
      </p>
      {showDataConsent ? <p className="mt-2 text-meta text-steel">{t("dataConsent")}</p> : null}
    </div>
  );
}
