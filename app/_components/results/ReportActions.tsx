"use client";

import { useState } from "react";
import { Check, FileText, Link2, Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { copyText, downloadFile } from "@/app/_lib/export-utils";
import { buildProvenanceDossier } from "@/app/_lib/provenance-dossier";
import type { AnalysisResult } from "@/app/_lib/schemas.generated";

// Share/export affordances for a saved candidate report (Theme C, RES1). The
// report previously had no way to leave the app — a recruiter handing it to a
// hiring manager had nothing but the raw URL to read out. Rendered only on the
// history detail page, whose /history/<slug> URL is stable + persisted, so
// "Copy report link" yields a link that reopens this exact report. `print:hidden`
// keeps the buttons themselves out of the printed/PDF output.
export function ReportActions({
  analysis,
  candidateLabel,
  savedAt,
}: {
  // idea-0832ec48 — when present, offer an exportable provenance dossier (every
  // score component beside its CV evidence). Optional so the component stays usable
  // wherever only copy-link/print make sense.
  analysis?: AnalysisResult;
  candidateLabel?: string | null;
  savedAt?: string | null;
} = {}) {
  const t = useTranslations("report");
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    const ok = await copyText(typeof window !== "undefined" ? window.location.href : "");
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 2000);
  };

  const exportDossier = () => {
    if (!analysis) return;
    const name = (candidateLabel || analysis.candidate?.name || "candidate").replace(/[^\w-]+/g, "_").slice(0, 50);
    downloadFile(`provenance-${name}.md`, buildProvenanceDossier(analysis, { candidateLabel, savedAt }), "text/markdown");
  };

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <button
        type="button"
        onClick={copyLink}
        className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 text-base font-semibold text-ink hover:border-coral/40"
      >
        {copied ? <Check size={15} className="text-moss" /> : <Link2 size={15} className="text-steel" />}
        {copied ? t("linkCopied") : t("copyLink")}
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 text-base font-semibold text-ink hover:border-coral/40"
      >
        <Printer size={15} className="text-steel" /> {t("print")}
      </button>
      {analysis ? (
        <button
          type="button"
          onClick={exportDossier}
          title={t("provenanceTitle")}
          className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 text-base font-semibold text-ink hover:border-coral/40"
        >
          <FileText size={15} className="text-steel" /> {t("provenance")}
        </button>
      ) : null}
    </div>
  );
}
