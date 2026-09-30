import type { GigDifficulty, GigPlanSeatId } from "./types";

// The models that write a gig's plan proposals, side by side on the gig's Plans report
// section. One place to change the lineup: the runner, the store and the report all read it.
// The lineup follows the brief's DIFFICULTY (operator decision 2026-09-30): an easy or
// ordinary gig gets one plan, a hard one one strong plan, a very hard one three competing
// designs. Ids probed on 2026-09-29/30 (`claude -p --model`, `codex exec -m`).
// `effort: null` = the CLI's default effort ("normal").

export type GigPlanProvider = "claude_cli" | "codex_cli";
export type GigPlanSeat = { seat: GigPlanSeatId; provider: GigPlanProvider; model: string; effort: string | null; label: string };

const SONNET_HIGH: GigPlanSeat = { seat: "sonnet", provider: "claude_cli", model: "claude-sonnet-5-5", effort: "high", label: "Sonnet 5.5 · high" };
const OPUS_HIGH: GigPlanSeat = { seat: "opus", provider: "claude_cli", model: "claude-opus-5-5", effort: "high", label: "Opus 5.5 · high" };
const OPUS_XHIGH: GigPlanSeat = { seat: "opus", provider: "claude_cli", model: "claude-opus-5-5", effort: "xhigh", label: "Opus 5.5 · xhigh" };
const FABLE: GigPlanSeat = { seat: "fable", provider: "claude_cli", model: "claude-fable-5", effort: null, label: "Fable 5" };
const GPT_MAX: GigPlanSeat = { seat: "gpt", provider: "codex_cli", model: "gpt-6-astra", effort: "max", label: "GPT 6 Astra · max" };

/** The seats that write plans for a gig of this difficulty: up to normal (and unrated, which
 *  a keyless brief always is) one Sonnet 5.5 high plan; hard one Opus 5.5 high plan; very
 *  hard three - Opus 5.5 xhigh, Fable 5 at its default effort, GPT 6 Astra at max. */
export function planSeatsFor(difficulty: GigDifficulty | null | undefined): readonly GigPlanSeat[] {
  if (difficulty === "very_hard") return [OPUS_XHIGH, FABLE, GPT_MAX];
  if (difficulty === "hard") return [OPUS_HIGH];
  return [SONNET_HIGH];
}

/** Every seat any difficulty can field (labels for rows already stored). */
export const GIG_PLAN_SEATS: readonly GigPlanSeat[] = [SONNET_HIGH, OPUS_HIGH, OPUS_XHIGH, FABLE, GPT_MAX];

/** A stored row's label: the seat at the effort it actually ran. */
export function planSeatLabel(row: { seat: GigPlanSeatId; effort: string | null }): string {
  return GIG_PLAN_SEATS.find((s) => s.seat === row.seat && s.effort === row.effort)?.label ?? GIG_PLAN_SEATS.find((s) => s.seat === row.seat)?.label ?? row.seat;
}

/** The execution model every gig persona runs on (the spark's doctrine: Opus 5.5 high). */
export const GIG_PERSONA_MODEL = { model: "claude-opus-5-5", effort: "high" } as const;

/** A gig persona's spend cap per run: `null` = uncapped (operator decision 2026-09-29). It
 *  is the persona's Personas `maxBudgetUsd`, the "Budget" line of its requirements and the
 *  assignment's `budgetUsd`; a number here caps all three again. The niche specialists keep
 *  their arena budget (specialist.ts). */
export const GIG_PERSONA_MAX_BUDGET_USD: number | null = null;
