// The first beat of /one — composed by the HOST from GET /api/attention, never by a model.
//
// One status line, the FIRST need (one, not a list: the needs panel holds the rest) and
// ≤ 4 chips. Priority is the order a recruiter loses the most by waiting:
//   decisions > pipeline aging > channels (new arrivals) > schedule > jobs drafts.
// Nothing waiting → the "all clear" line. A failed read → an honest "could not read"
// line, never "all clear" (unknown is not zero — attention.ts's own rule).
//
// The counts in the greeting are FETCHED (the attention read), not model-authored, so
// they may appear in its sentences; that is the line between the greeting and a Reply.
// `companion` (Candi's open proposals) is not a need here: it has no surface on /one
// that can answer it, so it is reported on the needs panel with its Console pointer.
import type { AttentionCounts } from "@/app/_lib/attention";
import type { ChipId, PanelKind } from "../types";

export const NEED_ORDER = ["decisions", "pipeline", "channels", "schedule", "jobs"] as const;
export type NeedKey = (typeof NEED_ORDER)[number];

/** The view that answers each need, and the chip that asks for it. */
export const NEED_PANEL: Record<NeedKey, { panel: PanelKind; params?: Record<string, string>; chip: ChipId }> = {
  decisions: { panel: "decisionsQueue", chip: "decisions" },
  pipeline: { panel: "pipelineSlice", params: { filter: "aging" }, chip: "stalled" },
  channels: { panel: "pipelineSlice", params: { filter: "new" }, chip: "arrivals" },
  schedule: { panel: "scheduleAhead", chip: "interviews" },
  jobs: { panel: "jobDrafts", chip: "drafts" },
};

export type Greeting =
  /** The read failed or never landed: say so, offer the questions that still work. */
  | { state: "unknown"; chips: ChipId[] }
  /** Nothing waits on the user. */
  | { state: "clear"; chips: ChipId[] }
  | {
      state: "needs";
      /** How many of the five buckets are non-zero — the status line's figure. */
      areas: number;
      /** The first need, by priority, with its count from the read. */
      first: { key: NeedKey; count: number; panel: PanelKind; params: Record<string, string> };
      chips: ChipId[];
    };

export function greeting(attention: AttentionCounts | null): Greeting {
  if (!attention) return { state: "unknown", chips: ["needs", "pipeline", "funnel"] };
  const waiting = NEED_ORDER.filter((k) => Number.isFinite(attention[k]) && attention[k] > 0);
  if (waiting.length === 0) return { state: "clear", chips: ["funnel", "pipeline", "outbox"] };
  const key = waiting[0];
  const spec = NEED_PANEL[key];
  // The first need's own chip leads (it is what "yes, show me" means), then the other
  // waiting buckets in priority order, then the general question — ≤ 4.
  const chips: ChipId[] = [];
  for (const k of waiting) {
    const c = NEED_PANEL[k].chip;
    if (!chips.includes(c)) chips.push(c);
  }
  if (!chips.includes("needs")) chips.push("needs");
  return {
    state: "needs",
    areas: waiting.length,
    first: { key, count: attention[key], panel: spec.panel, params: { ...(spec.params ?? {}) } },
    chips: chips.slice(0, 4),
  };
}
