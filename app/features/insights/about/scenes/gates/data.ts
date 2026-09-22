/*
 * Chapter 6 — WHAT FLOWS AND WHAT PARKS, as data.
 *
 * The beat table `GatesQueue.tsx` renders from, and the constants
 * chapters.test.ts pins. Pure (imports only the stage ladder), so
 * scenes/beats.test.ts walks every phase against the clock contract.
 *
 * Beats (CYCLE = 15 @ 900ms): 0 outline · 1 four actions · 2 the barrier · 3-6
 * each meets it · 7 the rejection explained · 8 what stays autonomous · 9 Hired
 * named · 10-14 hold. STILL = 9 (was 10, one beat late).
 */
import { stageOf, type ModuleStage } from "../../stage/stages";

export const CYCLE = 15;
export const STILL = 9;

/** The beats the status line changes on; `about.gates.status.s<n>` for each. */
export const STATUS_BEATS = [0, 2, 3, 4, 5, 6, 7, 9] as const;
export type StatusBeat = (typeof STATUS_BEATS)[number];

// `key` names the catalog entry; `kind` is the real approvalKind slug, which
// stays untranslated because it is the value stored on the row.
export const ACTIONS = [
  { id: "advanced", key: "advance", parks: false, kind: "" },
  { id: "hold", key: "hold", parks: false, kind: "" },
  { id: "auto_rejected", key: "reject", parks: true, kind: "rejection_review" },
  { id: "offer", key: "offer", parks: true, kind: "offer_review" },
] as const;

/** The function the note's code label names — exported from approval-kinds.ts. */
export const GATE_LABEL = "needsHumanDecision(kind)";

const meetsAt = (i: number) => 3 + i;

export type GatesFrame = {
  proposed: boolean;
  barrier: boolean;
  /** Per ACTIONS row: the left card, the right card, and whether it met the barrier. */
  from: readonly ModuleStage[];
  to: readonly ModuleStage[];
  met: readonly boolean[];
  note: ModuleStage;
  rejection: boolean;
  autonomous: boolean;
  hired: boolean;
};

export function sceneAt(phase: number): GatesFrame {
  const at = (n: number) => phase >= n;
  return {
    proposed: at(1),
    barrier: at(2),
    from: ACTIONS.map((_, i) => stageOf({ shell: 1, body: 1, detail: meetsAt(i), chosen: null }, phase)),
    to: ACTIONS.map((_, i) => stageOf({ shell: 2, body: meetsAt(i), detail: meetsAt(i), chosen: null }, phase)),
    met: ACTIONS.map((_, i) => at(meetsAt(i))),
    note: stageOf({ shell: 7, body: 7, detail: 9, chosen: null }, phase),
    rejection: at(7),
    autonomous: at(8),
    hired: at(9),
  };
}
