"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { splitSanityChecks } from "@/app/_lib/sanity-checks";

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
          <span className="ml-auto">{toggle}</span>
        </div>
        {open ? <CheckList items={oks} tone="ok" /> : null}
      </div>
    );
  }

  return (
    <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-panel">
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle size={16} className="text-amber-600" aria-hidden />
        <span className="text-meta uppercase tracking-wide text-amber-800">{t("title")}</span>
        <span className="rounded-full bg-amber-600 px-2.5 py-0.5 text-sm font-semibold text-white">
          {t("flagged", { count: warns.length })}
        </span>
        <span className="ml-auto">{toggle}</span>
      </div>
      <CheckList items={warns} tone="warn" />
      {open && oks.length > 0 ? <CheckList items={oks} tone="ok" /> : null}
    </div>
  );
}

function CheckList({ items, tone }: { items: string[]; tone: "warn" | "ok" }) {
  return (
    <ul className={`mt-2 space-y-1 text-sm ${tone === "warn" ? "text-amber-900" : "text-steel"}`}>
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
  );
}
