"use client";

/*
 * Shared vocabulary for the plan-impact preview cards (Settings → Hiring).
 *
 * The impact strip's promise is that a recruiter reads CONSEQUENCES, not config:
 * move a gate, see what Overview / Decisions / Schedule will look like. But the
 * three cards were one `ImpactPanel` rendered three times — same white rectangle,
 * same pill soup — so the eye had to read the label to learn which destination it
 * was looking at, and the strip read as one undifferentiated legend.
 *
 * This module owns the per-destination IDENTITY (silhouette, accent, icon, voice)
 * so every variant inherits the SAME three recognisable cards, plus the pure
 * readings of the plan the variants draw. Each card borrows its destination tab's
 * own grammar: Overview = the board's ruled columns + coral toolbar edge;
 * Decisions = a ledger with an amber margin rule; Schedule = a calendar with a
 * tinted header band (the same `bg-paper`/`bg-blue-50` header the week grid uses).
 */
import type { LucideIcon } from "lucide-react";
import { Bot, CalendarClock, LayoutDashboard, Scale, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { PANEL } from "@/app/_components/ui/recipes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { prunePlanToAxis } from "@/app/_lib/decision-config-schema";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import type { GateMode, PipelinePlan, RoundKind } from "../pipelineComposerModel";
import { DEFAULT_STAGE_AXIS } from "@/app/_lib/pipeline-stages";

export type ImpactTone = "overview" | "decisions" | "schedule";

type ToneSkin = {
  icon: LucideIcon;
  /** Card silhouette. Each destination wears its own edge treatment so the three
   *  cards are distinguishable with the labels covered. */
  shell: string;
  /** Header band — Schedule alone gets a filled, ruled-off one (calendar chrome). */
  head: string;
  /** Eyebrow + icon color. */
  accent: string;
  /** "This is live under your plan" pill. */
  chip: string;
  /** "Nothing happens here" pill. */
  quiet: string;
  /** Track / rail / progress color for the destination's own diagram. */
  rule: string;
};

export const TONE: Record<ImpactTone, ToneSkin> = {
  overview: {
    icon: LayoutDashboard,
    shell: `${PANEL} overflow-hidden border-t-4 border-t-coral`,
    head: "px-4 pb-2 pt-3",
    accent: "text-coral",
    chip: "bg-coral/10 text-coral",
    quiet: "bg-stone-100 text-steel",
    rule: "bg-coral",
  },
  decisions: {
    icon: Scale,
    shell: `${PANEL} overflow-hidden border-l-4 border-l-dial-amber`,
    head: "px-4 pb-2 pt-3",
    accent: "text-amber-700",
    chip: "bg-amber-50 text-amber-800",
    quiet: "bg-stone-100 text-steel",
    rule: "bg-dial-amber",
  },
  schedule: {
    icon: CalendarClock,
    shell: `${PANEL} overflow-hidden`,
    head: "border-b border-stone-200 bg-blue-50 px-4 pb-2 pt-3",
    accent: "text-blue-700",
    chip: "bg-blue-50 text-blue-700",
    quiet: "bg-stone-100 text-steel",
    rule: "bg-steel",
  },
};

/** The card shell every variant renders into: identity in the frame, the reading
 *  in the body. `aside` is the headline fact (a count, a stat) — top-right. */
export function ImpactCard({
  tone,
  title,
  sub,
  aside,
  children,
}: {
  tone: ImpactTone;
  title: string;
  sub: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const skin = TONE[tone];
  const Icon = skin.icon;
  return (
    <section className={`${skin.shell} flex flex-col`} aria-label={title}>
      <header className={`${skin.head} flex items-start justify-between gap-3`}>
        <div className="min-w-0">
          <p className={`flex items-center gap-1.5 text-meta uppercase ${skin.accent}`}>
            <Icon size={13} aria-hidden /> {title}
          </p>
          <p className="mt-0.5 text-sm text-steel">{sub}</p>
        </div>
        {aside ? <div className="shrink-0 text-right">{aside}</div> : null}
      </header>
      <div className="flex-1 px-4 pb-4 pt-3">{children}</div>
    </section>
  );
}

/** A round, as it appears wherever a round appears: AI is an action (coral),
 *  a human round is a person (neutral, outlined). */
export function RoundChip({ kind, dense = false }: { kind: RoundKind; dense?: boolean }) {
  const t = useTranslations("hiringPlan.impact");
  const Icon = kind === "ai" ? Bot : UserRound;
  const pad = dense ? "px-1.5 py-0.5" : "px-2 py-0.5";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full ${pad} text-sm font-semibold ${
        kind === "ai" ? "bg-coral/10 text-coral" : "border border-stone-300 bg-white text-ink"
      }`}
    >
      <Icon size={11} aria-hidden /> {kind === "ai" ? t("roundAi") : t("roundHuman")}
    </span>
  );
}

/** The station label the cards say out loud, resolved ONCE.
 *
 *  A workspace-renamed column shows its own words; a shipped one stays localized
 *  through `enums.stage.*` — the same catalog PipelineBoard draws its column
 *  headers from, which is why Settings and Overview read as one product. */
export function useImpactCopy(axis: readonly StageDef[]) {
  const enumLabel = useEnumLabel();
  const stationLabel = (id: string): string => {
    const stage = axis.find((s) => s.id === id);
    return stage && stage.label !== stage.id ? stage.label : enumLabel("stage", id);
  };
  return { stationLabel };
}

/** EVERY point in the plan where a verdict could be ratified, human or not —
 *  the reading the old strip could not give, because it listed only the human
 *  queues and so never showed what the recruiter had switched OFF.
 *
 *  Mirrors `deriveImpact`'s rule that a human round's verdict is human by
 *  definition (the gate only governs AI rounds). */
export type GateRow = {
  key: string;
  kind: "screening" | "round" | "offer";
  /** The board column this ratification point sits at — so the ledger can name
   *  the recruiter's own column instead of a generic station word. */
  stageId: string;
  /** 1-based round number, for `stationRound`. */
  n?: number;
  roundKind?: RoundKind;
  mode: GateMode;
};

/** EVERY point in the plan where a verdict could be ratified, walked in BOARD
 *  order. It used to assume the shape — screening, then every round, then offer —
 *  because the plan was three loose fields and the order was the only structure
 *  there was. The plan names its columns now, so this reads the board and asks
 *  what each column does, which is also the only way a second screening column
 *  can appear in the ledger at all. */
export function gateLedger(plan: PipelinePlan, axis: readonly StageDef[] = DEFAULT_STAGE_AXIS): GateRow[] {
  const rows: GateRow[] = [];
  let n = 0;
  // The plan AS THE SERVER WILL READ IT — same projection `deriveImpact` takes,
  // so the ladder and the touchpoint count beside it cannot disagree. The
  // composer is the only reader that holds the raw blob (it loads
  // getAllDecisionConfigs, not getInterviewPlan), so a step at a column this axis
  // has dropped or re-roled would otherwise draw a checkpoint nobody ever reaches.
  const live = prunePlanToAxis(plan, axis);
  for (const stage of axis) {
    const step = live.steps.find((s) => s.stageId === stage.id);
    if (!step) continue;
    if (stage.role === "screening") rows.push({ key: `${stage.id}:gate`, kind: "screening", stageId: stage.id, mode: step.gate });
    step.rounds.forEach((r, i) => {
      n += 1;
      rows.push({
        key: `${stage.id}:${i}`,
        kind: "round",
        stageId: stage.id,
        n,
        roundKind: r.kind,
        mode: (r.kind === "human" ? "human" : r.gate) as GateMode,
      });
    });
    if (stage.role === "offer") rows.push({ key: `${stage.id}:gate`, kind: "offer", stageId: stage.id, mode: step.gate });
  }
  return rows;
}
