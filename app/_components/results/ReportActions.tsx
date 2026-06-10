"use client";

import { useState } from "react";
import { Check, Link2, Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { copyText } from "@/app/_lib/export-utils";

// Share/export affordances for a saved candidate report (Theme C, RES1). The
// report previously had no way to leave the app — a recruiter handing it to a
// hiring manager had nothing but the raw URL to read out. Rendered only on the
// history detail page, whose /history/<slug> URL is stable + persisted, so
// "Copy report link" yields a link that reopens this exact report. `print:hidden`
// keeps the buttons themselves out of the printed/PDF output.
export function ReportActions() {
  const t = useTranslations("report");
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    const ok = await copyText(typeof window !== "undefined" ? window.location.href : "");
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 2000);
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
    </div>
  );
}
