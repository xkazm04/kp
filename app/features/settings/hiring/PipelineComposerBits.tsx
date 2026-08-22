"use client";

// The policy cell's controls — one button per decision.
//
// These were two-button segmented toggles ([Human approves | Auto], [AI | Human]).
// In a table that shows one row per board column that was four buttons and two
// group borders per interview round, the labels wrapped to two lines inside their
// slot, and no two rows lined up. A binary choice does not need two controls: the
// button SHOWS the current answer and clicking it flips to the other one, which is
// half the elements, one line of text, and a fixed width every row can share.
//
// The icon carries the meaning and a `title` carries the sentence — including what
// clicking will do, which is the part an icon cannot say. Every button also has a
// real accessible name and `aria-pressed` is deliberately absent: this is not a
// toggle that is on or off, it is a value that alternates, so the name states the
// value instead.
import { Bot, Check, UserRound, Zap, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Select } from "@/app/_components/Select";
import type { GateMode, RoundKind } from "./pipelineComposerModel";

export { PlanImpactStrip } from "./impact/PlanImpactStrip";

/** Fixed slot widths, so the same decision sits in the same column on every row —
 *  and wide enough that no label truncates, which the halved name field and the
 *  retired per-round remove button paid for. A row whose column has no such
 *  decision renders the slot empty rather than collapsing it; alignment is why the
 *  two tables were merged in the first place. */
const SLOT = "flex items-center self-stretch border-l border-stone-200 px-0.5";
export const POLICY_SLOT = {
  cohort: `${SLOT} w-36`,
  executor: `${SLOT} w-28`,
  guard: `${SLOT} w-28`,
} as const;

const BTN =
  "focus-ring inline-flex h-8 w-full items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2 text-sm font-semibold text-ink transition-colors hover:border-coral/40";

/** One binary decision as ONE button: icon + the current value, click to flip. */
function PolicyButton({
  icon: Icon,
  label,
  title,
  ariaLabel,
  onClick,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  /** The full sentence, including what a click does. */
  title: string;
  ariaLabel: string;
  onClick: () => void;
  accent: string;
}) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={ariaLabel} className={BTN}>
      <Icon size={13} aria-hidden className={`shrink-0 ${accent}`} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** A decision the product makes for you — same footprint, no affordance. Rendered
 *  as text-on-surface rather than as a disabled button, because a control that can
 *  never be operated reads as broken rather than as settled. */
export function PolicyStatic({ icon: Icon, label, title }: { icon: LucideIcon; label: string; title: string }) {
  return (
    // A transparent border matching the button's, so a stated value starts at the
    // same x as a chosen one and the column reads as one edge.
    <span title={title} className="inline-flex h-8 w-full items-center gap-1.5 rounded-md border border-transparent px-2 text-sm text-steel">
      <Icon size={13} aria-hidden className="shrink-0 text-stone-400" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Who ratifies the verdict here: a person in Decisions, or nobody. */
export function GateButton({ value, onChange, stage }: { value: GateMode; onChange: (v: GateMode) => void; stage: string }) {
  const t = useTranslations("hiringPlan");
  const human = value === "human";
  return (
    <PolicyButton
      icon={human ? Check : Zap}
      label={human ? t("gateShortHuman") : t("gateAuto")}
      title={human ? t("tipGateHuman") : t("tipGateAuto")}
      ariaLabel={t("gateAriaFor", { stage })}
      accent={human ? "text-moss" : "text-coral"}
      onClick={() => onChange(human ? "auto" : "human")}
    />
  );
}

/** Who runs the conversation: the AI interviewer, or a person. */
export function KindButton({ value, onChange, stage }: { value: RoundKind; onChange: (v: RoundKind) => void; stage: string }) {
  const t = useTranslations("hiringPlan");
  const ai = value === "ai";
  return (
    <PolicyButton
      icon={ai ? Bot : UserRound}
      label={ai ? t("kindAi") : t("kindHuman")}
      title={ai ? t("tipKindAi") : t("tipKindHuman")}
      ariaLabel={t("kindAriaFor", { stage })}
      accent={ai ? "text-coral" : "text-moss"}
      onClick={() => onChange(ai ? "human" : "ai")}
    />
  );
}

/** Cohort reducer INTO a round: everyone who advanced, or only the top N.
 *
 *  The app's own Select, not a native one — an OS-rendered option list ignores the
 *  theme tokens, so in Spark Dark the closed control re-skinned and the open menu
 *  stayed a light OS menu. */
export function CohortSelect({
  value,
  onChange,
  stage,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  stage: string;
}) {
  const t = useTranslations("hiringPlan");
  return (
    <Select
      value={value == null ? "all" : String(value)}
      onChange={(next) => onChange(next === "all" ? null : Number(next))}
      ariaLabel={t("cohortAriaFor", { stage })}
      sizeVariant="sm"
      className="w-full"
      options={[
        { value: "all", label: t("cohortEveryone") },
        ...[2, 3, 5, 8].map((n) => ({ value: String(n), label: t("cohortTopN", { n }) })),
      ]}
    />
  );
}
