"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { authenticityBand, splitSanityChecks } from "@/app/_lib/sanity-checks";
import { META_LABEL, NOTICE } from "@/app/_components/ui/recipes";

// The engine's per-analysis trust ledger (`sanityChecks`), surfaced (SCOR2).
// The pipeline states every repair, degradation and self-contradiction it
// detects — "Salary range needs manual review", "Score total disagrees with its
// breakdown", "Interview kit unavailable — insight skipped" — and until now the
// UI rendered none of it, so a degraded analysis was visually identical to a
// clean one. Warn-shaped checks get a loud amber callout above the tabs; clean
// checks stay collapsed behind a toggle. The check sentences themselves are
// deterministic engine English (not --lang localized) and are shown verbatim;
// only the chrome is translated.
export function QualityStrip({ checks }: { checks: string[] }) {
  const t = useTranslations("results.quality");
  const [open, setOpen] = useState(false);
  const { warns, oks } = splitSanityChecks(checks);
  // idea-cae71d45 — the CV-authenticity trust band, derived from the
  // `Authenticity:` findings the engine folded into the trust ledger.
  const band = authenticityBand(checks);
  if (checks.length === 0) return null;

  const toggle = (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      className="focus-ring inline-flex items-center gap-1 rounded-md text-sm font-semibold text-steel hover:text-ink"
    >
      {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
      {t("viewChecks", { count: checks.length })}
    </button>
  );

  if (warns.length === 0) {
    // Clean run: one quiet line, expandable for the curious.
    return (
      <div className="rounded-lg border border-stone-200 bg-paper/60 px-4 py-2.5 text-sm text-steel">
        <div className="flex flex-wrap items-center gap-2">
          <Check size={14} className="text-moss" aria-hidden />
          <span>{t("allPassed", { count: checks.length })}</span>
          {band ? <TrustBand band={band} /> : null}
          <span className="ml-auto">{toggle}</span>
        </div>
        {open ? <CheckList items={oks} tone="ok" /> : null}
      </div>
    );
  }

  return (
    <div role="status" className={`${NOTICE("amber")} p-4 shadow-panel`}>
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle size={16} className="text-amber-600" aria-hidden />
        <span className="text-meta uppercase tracking-wide text-amber-800">{t("title")}</span>
        <span className="rounded-full bg-amber-600 px-2.5 py-0.5 text-sm font-semibold text-white">
          {t("flagged", { count: warns.length })}
        </span>
        {band ? <TrustBand band={band} /> : null}
        <span className="ml-auto">{toggle}</span>
      </div>
      <CheckList items={warns} tone="warn" />
      {open && oks.length > 0 ? <CheckList items={oks} tone="ok" /> : null}
    </div>
  );
}

// idea-cae71d45 — the authenticity trust band chip. High = green, medium = amber,
// low = coral; the title points the recruiter at the Authenticity lines below.
function TrustBand({ band }: { band: "high" | "medium" | "low" }) {
  const t = useTranslations("results.quality");
  const tone = band === "high" ? "bg-moss/10 text-moss" : band === "medium" ? "bg-amber-100 text-amber-800" : "bg-coral/10 text-coral";
  const label = band === "high" ? t("trustHigh") : band === "medium" ? t("trustMedium") : t("trustLow");
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-semibold ${tone}`} title={t("trustTitle")}>
      <ShieldCheck size={12} aria-hidden /> {label}
    </span>
  );
}

function CheckList({ items, tone }: { items: string[]; tone: "warn" | "ok" }) {
  const t = useTranslations("results.quality");
  return (
    <>
      {/* The chrome above is localized; these sentences are NOT — they are the
          engine's own deterministic English ("Salary range needs manual review"),
          shown verbatim so a degraded run is not paraphrased. A Czech reader was
          given no way to tell which half was machine text; this label says so. */}
      <p className={`mt-2 ${META_LABEL}`} title={t("engineNoteTitle")}>
        {t("engineNote")}
      </p>
      <ul className={`mt-1 space-y-1 text-sm ${tone === "warn" ? "text-amber-900" : "text-steel"}`}>
        {items.map((check) => (
          <li key={check} className="flex items-start gap-1.5">
            {tone === "warn" ? (
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
            ) : (
              <Check size={13} className="mt-0.5 shrink-0 text-moss" aria-hidden />
            )}
            {check}
          </li>
        ))}
      </ul>
    </>
  );
}
