import type { GigPlanSeatId } from "./types";

// The models that write a gig's plan proposals, side by side on the gig's Plans tab
// (gig-mastery S1). One place to change the lineup: the runner, the store and the tab all
// read this list. Ids probed with a one-word `claude -p --model <id>` call on 2026-09-29.
// `effort: null` = the CLI's default effort ("normal").

export type GigPlanSeat = { seat: GigPlanSeatId; model: string; effort: string | null; label: string };

export const GIG_PLAN_SEATS: readonly GigPlanSeat[] = [
  { seat: "fable", model: "claude-fable-5", effort: null, label: "Fable 5" },
  { seat: "opus", model: "claude-opus-5-5", effort: "xhigh", label: "Opus 5.5 · xhigh" },
  { seat: "sonnet", model: "claude-sonnet-5-5", effort: "high", label: "Sonnet 5.5 · high" },
];

/** The execution model every gig persona runs on (the spark's doctrine: Opus 5.5 high). */
export const GIG_PERSONA_MODEL = { model: "claude-opus-5-5", effort: "high" } as const;
