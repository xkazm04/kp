import { GIG_CHECKLISTS } from "@/app/_lib/gigs/checklists";
import { type DraftLintFinding, lintGate } from "@/app/_lib/gigs/draft-lint";
import { GIG_DISCLOSURE_ITEM, type GigArena } from "@/app/_lib/gigs/types";

// ---------------------------------------------------------------------------
// Facts about one gig
// ---------------------------------------------------------------------------

export type DeadlineView = { state: "none" } | { state: "passed" | "soon" | "open"; days: number; at: string };

const DAY_MS = 86_400_000;

export function deadlineView(deadlineAt: string | null, now: Date): DeadlineView {
  if (!deadlineAt) return { state: "none" };
  const t = Date.parse(deadlineAt);
  if (!Number.isFinite(t)) return { state: "none" };
  const days = Math.floor((t - now.getTime()) / DAY_MS);
  if (t < now.getTime()) return { state: "passed", days, at: deadlineAt };
  return { state: days <= 3 ? "soon" : "open", days, at: deadlineAt };
}

export type EvidenceState = "passed" | "failed" | "unverified";

/** Three states, never two: `passed: null` ran with no pass/fail meaning, which is
 *  not a failure and must not be painted as one. */
export function evidenceState(passed: boolean | null): EvidenceState {
  return passed === true ? "passed" : passed === false ? "failed" : "unverified";
}

export function checklistFor(arena: GigArena): readonly string[] {
  return GIG_CHECKLISTS[arena] ?? [GIG_DISCLOSURE_ITEM];
}

// ---------------------------------------------------------------------------
// The desk's Approve / Mark sent gate
// ---------------------------------------------------------------------------

export type DeskGate = {
  ticked: number;
  total: number;
  blockers: number;
  unseenWarns: number;
  /** Approve can be pressed. */
  ready: boolean;
  /** The first unmet condition, for the button label; null when ready. */
  reason: { kind: "blockers"; count: number } | { kind: "checklist"; ticked: number; total: number } | { kind: "unseen"; count: number } | null;
};

export function deskGate(
  items: readonly string[],
  ticks: Readonly<Record<string, boolean>>,
  findings: readonly DraftLintFinding[],
  seen: ReadonlySet<string>
): DeskGate {
  const ticked = items.filter((k) => ticks[k] === true).length;
  const total = items.length;
  const { blockers, unseenWarns } = lintGate(findings, seen);
  const reason: DeskGate["reason"] =
    blockers > 0
      ? { kind: "blockers", count: blockers }
      : ticked < total
        ? { kind: "checklist", ticked, total }
        : unseenWarns > 0
          ? { kind: "unseen", count: unseenWarns }
          : null;
  return { ticked, total, blockers, unseenWarns, ready: reason === null, reason };
}

/** Mark sent needs the checklist complete (the server refuses without the disclosure
 *  tick; the desk asks for all of them, as it did at approve). */
export function markSentGate(items: readonly string[], ticks: Readonly<Record<string, boolean>>): { ticked: number; total: number; ready: boolean } {
  const ticked = items.filter((k) => ticks[k] === true).length;
  return { ticked, total: items.length, ready: ticked === items.length };
}
