"use client";

// The Orchard's header: a Back arrow before the role title (the overlay is a place
// you stepped INTO from the board, so it leaves the way it came), the stage and
// head-count, the four band tallies, and the salary caveat it must never drop.

import { ArrowLeft } from "lucide-react";
import type { ScoreTone } from "@/app/_lib/format";
import { BTN_GHOST, EYEBROW, META_LABEL } from "@/app/_components/ui/recipes";
import { TONE_BAR, TONE_TEXT } from "../mapTone";
import { BAND_LABEL, ORCHARD_COPY as COPY } from "./orchardCopy";
import type { BandCounts } from "./orchardLayout";

export function OrchardHeader({
  title,
  stageLabel,
  count,
  bands,
  onBack,
}: {
  title: string;
  stageLabel: string;
  count: number;
  bands: BandCounts;
  onBack: () => void;
}) {
  return (
    <header className="border-b border-stone-200 px-6 py-4">
      <p className={`${EYEBROW} pl-12`}>{COPY.eyebrow}</p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label={COPY.back}
          title={COPY.back}
          className={`${BTN_GHOST} h-9 w-9 shrink-0 justify-center`}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <h2 className="min-w-0 truncate font-serif text-h2 text-ink">{title}</h2>
      </div>
      <div className="pl-12">
        <p className="mt-0.5 text-sm text-steel">
          {stageLabel} · <span className="nums">{count}</span> {count === 1 ? COPY.one : COPY.many}
        </p>
        <ul className="mt-2 flex flex-wrap items-center gap-2">
          <BandToken tone="weak" label={BAND_LABEL.weak} value={bands.weak} />
          <BandToken tone="mid" label={BAND_LABEL.mid} value={bands.mid} />
          <BandToken tone="strong" label={BAND_LABEL.strong} value={bands.strong} />
          <BandToken tone="null" label={COPY.unscored} value={bands.unscored} />
        </ul>
        {/* The columns are money, and the money is an estimate (mapSalary.ts). */}
        <p className={`mt-2 ${META_LABEL}`}>{COPY.salaryCaveat}</p>
      </div>
    </header>
  );
}

function BandToken({ tone, label, value }: { tone: ScoreTone; label: string; value: number }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2 py-0.5">
      <span className={`h-2 w-2 rounded-full ${TONE_BAR[tone]}`} aria-hidden="true" />
      <span className={`nums text-sm font-semibold ${TONE_TEXT[tone]}`}>{value}</span>
      <span className={META_LABEL}>{label}</span>
    </li>
  );
}
