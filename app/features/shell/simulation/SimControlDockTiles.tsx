"use client";

// Small presentational pieces of the Flight Deck control dock, split out of
// SimControlDock.tsx so it stays under the 200-line file cap. Verbatim markup —
// the Candi power switch, one automation module tile, the elevated guided-demo
// tile, and the dry-run/committed/error pass strip (AUTO3 look-before-commit).
import { Check, Play, X, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import type { useAutomationPass, PassSummary } from "./simControlCenterKit";

// The Candi power switch. Same element raises the deck (collapsed) and lowers it
// (expanded) — the one show/hide control the whole variant hangs off.
export function CandiSwitch({ open, onClick, busy }: { open: boolean; onClick: () => void; busy: boolean }) {
  const t = useTranslations("pipeline.controlCenter");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? t("close") : t("open")}
      aria-expanded={open}
      className="focus-ring group relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border-2 border-stone-300 bg-white shadow-sticker-sm transition-colors hover:border-coral/50"
    >
      <KandidateMark className="h-7 w-7 text-ink [--k-fg:var(--color-paper)] [--k-accent:var(--color-coral)]" />
      {busy ? (
        <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-coral ring-2 ring-white motion-safe:animate-pulse" />
      ) : null}
    </button>
  );
}

// One automation module in the ops deck — icon sticker + label (+ optional live
// sublabel), coral-lit when active. Real recruitment affordance, not a marker.
export function DeckTile({
  icon: Icon,
  label,
  sublabel,
  onClick,
  active = false,
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  sublabel?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`focus-ring group inline-flex h-11 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
        active ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-ink hover:border-coral/40"
      }`}
    >
      <span
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border transition-colors ${
          active ? "border-coral/40 bg-white text-coral" : "border-stone-200 bg-paper text-steel group-hover:text-coral"
        }`}
      >
        <Icon size={15} aria-hidden />
      </span>
      <span className="flex flex-col items-start leading-tight">
        <span>{label}</span>
        {sublabel ? <span className="text-meta font-medium text-steel">{sublabel}</span> : null}
      </span>
    </button>
  );
}

// The guided-demo entry, elevated out of the utility DeckTile row: this is the
// deck's one INVITATION (watch the whole hiring story) rather than an operation,
// so it gets the first-run wizard's sticker treatment — drawn ink outline, paper
// fill, coral play medallion, press-down hover — while keeping the row's h-11
// rhythm. Tokens only; the tilt/press are the Spark-dark structural motifs.
export function GuidedDemoTile({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring group inline-flex h-11 items-center gap-2.5 rounded-xl border-2 border-ink bg-paper px-3.5 text-sm font-semibold text-ink shadow-sticker-sm transition-all hover:-translate-y-0.5 hover:shadow-pop motion-reduce:transition-none motion-reduce:hover:translate-y-0 dark:-rotate-1 dark:hover:rotate-0"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-coral text-white shadow-sticker-xs transition-transform group-hover:scale-105 motion-reduce:transition-none">
        <Play size={13} aria-hidden className="translate-x-px" />
      </span>
      {label}
    </button>
  );
}

// The dry-run / committed / error tape that unrolls under the deck when the
// automation pass runs — the AUTO3 look-before-commit gate, tokenized.
export function PassStrip({ pass }: { pass: ReturnType<typeof useAutomationPass> }) {
  const t = useTranslations("pipeline.controlCenter");
  const line = (s: PassSummary) => t("passLine", { advanced: s.advanced, rejected: s.rejected, held: s.held, alerts: s.alerts });
  if (pass.error) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        <span>{pass.error}</span>
        <button type="button" onClick={pass.dismiss} aria-label={t("dismiss")} className="focus-ring rounded p-0.5 hover:opacity-70">
          <X size={14} aria-hidden />
        </button>
      </div>
    );
  }
  if (pass.committed) {
    return (
      <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-moss/30 bg-moss/5 px-3 py-2 text-sm text-ink">
        <span className="inline-flex items-center gap-1.5 font-semibold text-moss">
          <Check size={14} aria-hidden /> {t("passApplied")}
        </span>
        <span className="text-steel nums">{line(pass.committed)}</span>
        <button type="button" onClick={pass.dismiss} className="focus-ring ml-auto text-meta font-semibold text-steel hover:text-ink">
          {t("dismiss")}
        </button>
      </div>
    );
  }
  // The pending dry run is shown in the full PassPreviewModal (per-decision,
  // reject-first), not here — this strip only carries the after-states.
  return null;
}
