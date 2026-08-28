"use client";

// ONE THREAD (gap 8) — the one chip every status axis on the hiring thread renders
// through, and the one legend that explains it.
//
// The tone DECISION lives in app/_lib/status-tone.ts (pure, tested, exhaustive per
// axis). This file is the wiring: it turns a StatusTone into pixels exactly once,
// so the five axes cannot drift apart again the way they had (draft stone here,
// closed amber there, awaiting_approval amber somewhere else, and a board stage
// that was not a chip at all).
//
// Built ON the existing Badge primitive rather than beside it. Badge already owns
// the shape, the token palette, the icon slot and — the part worth not
// re-deriving — the per-variant accessible-name rule (role="img" + aria-label only
// when the description is richer than the visible text, because a bare <span> maps
// to role="generic" where ARIA prohibits a label). A second chip component would
// have re-litigated all of that and got some of it wrong.
//
// STOPPED IS NOT RED. It maps to Badge's `muted` treatment, not to the `critical`
// tone. A closed job, a closed assignment and a revoked interview link are ordinary
// outcomes, and painting them the same red as a failure would make the board read
// as full of errors. `failed` shares the tone for the same reason the axis shares
// the chip: what the reader needs is "this thread stopped here", and the label
// already says which way. Only genuine judgements (a reject verdict, a broken
// integrity check) stay red, and those are verdicts, not statuses.
//
// Locale-dumb like Badge: the caller passes the axis's own label, because each axis
// keeps its own words. The only strings this module names are the five TONE names
// in the legend, and it reads those through `useStatusToneLabels` so a call site
// gets them in one line instead of threading five props.

import type { LucideIcon } from "lucide-react";
import { CheckCircle2, CircleDashed, CircleDot, Hourglass, MinusCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "./Badge";
import { STATUS_TONES, type StatusTone } from "@/app/_lib/status-tone";

/** How each reading state is drawn. Exhaustive over StatusTone, so a sixth state
 *  cannot be introduced without deciding what it looks like. */
const TONE_RENDER: Record<StatusTone, { tone: BadgeTone; icon: LucideIcon; muted?: boolean }> = {
  neutral: { tone: "neutral", icon: CircleDashed },
  active: { tone: "info", icon: CircleDot },
  waiting: { tone: "caution", icon: Hourglass },
  done: { tone: "positive", icon: CheckCircle2 },
  stopped: { tone: "neutral", icon: MinusCircle, muted: true },
};

export function StatusChip({
  tone,
  label,
  ariaLabel,
  className = "",
}: {
  tone: StatusTone;
  /** The axis's own word for this value — localized by the caller. */
  label: string;
  /** Fuller description for assistive tech, e.g. "Assignment stage: collecting". */
  ariaLabel?: string;
  className?: string;
}) {
  const r = TONE_RENDER[tone];
  return <Badge tone={r.tone} icon={r.icon} muted={r.muted} label={label} ariaLabel={ariaLabel} className={className} />;
}

/** The five tone names, localized. Kept here (rather than at each call site) so the
 *  legend and any future consumer read ONE catalog — `status.tone.*`. */
export function useStatusToneLabels(): Record<StatusTone, string> {
  const t = useTranslations("status.tone");
  return {
    neutral: t("neutral"),
    active: t("active"),
    waiting: t("waiting"),
    done: t("done"),
    stopped: t("stopped"),
  };
}

/** The single legend for every status chip on the thread.
 *
 *  Rendered as a definition-free inline row of the same chips it explains, in
 *  STATUS_TONES order (nothing-yet → running → blocked → finished → stopped short),
 *  so the reader learns the vocabulary from the artefact itself rather than from a
 *  colour key they then have to map back. */
export function StatusLegend({ className = "" }: { className?: string }) {
  const t = useTranslations("status.legend");
  const labels = useStatusToneLabels();
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-steel ${className}`}>
      <span className="font-semibold uppercase tracking-wide">{t("title")}</span>
      {STATUS_TONES.map((tone) => (
        <StatusChip key={tone} tone={tone} label={labels[tone]} />
      ))}
    </div>
  );
}
