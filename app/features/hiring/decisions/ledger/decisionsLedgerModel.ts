// The decisions LEDGER's row model — pure, so the three prototype variants render
// one derivation and the sort/grouping rules are unit-tested.
//
// A row is one AI recommendation waiting on a human: who, for which role, how well
// they fit, what the AI proposes, and whether the row may join a batch. The kind
// mirrors the card logic it replaced (decisionsAiReviewCardLogic.ts): the approval
// kind decides it, with the scorecard's `source` telling a human interviewer's
// scorecard from the AI's.

import type { InterviewRecommendation } from "@/app/_lib/interview-recommendation";
import { canonicalScoreOf } from "@/app/_lib/match-score";
import type { Entry } from "@/app/features/shared/decisionsTypes";
import type { ParsedApproval } from "../decisionsAiReviewCardLogic";

export type LedgerKind = "screening" | "scorecard" | "humanScorecard" | "queuedReject" | "offer";

export type LedgerRow = {
  entry: Entry;
  kind: LedgerKind;
  /** The AI's verdict — null on an offer, where the proposal is money. */
  recommendation: InterviewRecommendation | null;
  /** The proposed offer; `amount` null = the fail-safe draft that priced nothing. */
  offer: { amount: number | null; currency: string | null } | null;
  /** The ONE fit number (canonical read path), null when unscored. */
  score: number | null;
  /** May join a batch decision (offers are decided one by one). */
  eligible: boolean;
  staleSince: string | null;
};

export function parseApproval(entry: Pick<Entry, "approvalDetail">): ParsedApproval | null {
  try {
    return entry.approvalDetail ? (JSON.parse(entry.approvalDetail) as ParsedApproval) : null;
  } catch {
    return null; // an unparseable payload renders as "no proposal", never as a crash
  }
}

export function ledgerKindOf(entry: Pick<Entry, "approvalKind">, parsed: ParsedApproval | null): LedgerKind {
  if (entry.approvalKind === "offer_review") return "offer";
  if (entry.approvalKind === "rejection_review") return "queuedReject";
  if (entry.approvalKind === "scorecard_review") return parsed?.source === "human" ? "humanScorecard" : "scorecard";
  return "screening";
}

export function ledgerRowOf(entry: Entry, staleSince: string | null): LedgerRow {
  const parsed = parseApproval(entry);
  const kind = ledgerKindOf(entry, parsed);
  return {
    entry,
    kind,
    recommendation: kind === "offer" ? null : (parsed?.recommendation ?? null),
    offer: kind === "offer" ? { amount: parsed?.recommended ?? null, currency: parsed?.currency ?? null } : null,
    score: canonicalScoreOf(entry),
    eligible: kind !== "offer",
    staleSince,
  };
}

/** Role A→Z, then best fit first; unscored rows sink to the bottom of their role. */
export function sortLedgerRows(rows: readonly LedgerRow[], locale: string): LedgerRow[] {
  return [...rows].sort((a, b) => {
    const role = (a.entry.jobTitle ?? "").localeCompare(b.entry.jobTitle ?? "", locale);
    if (role !== 0) return role;
    if (a.score == null && b.score == null) return a.entry.candidateLabel.localeCompare(b.entry.candidateLabel, locale);
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    return b.score - a.score;
  });
}

export type LedgerGroup = { key: string; title: string; rows: LedgerRow[]; best: number | null };

/** The sorted rows folded by role, in role order, each with its best fit. */
export function groupLedgerRows(sorted: readonly LedgerRow[]): LedgerGroup[] {
  const groups: LedgerGroup[] = [];
  for (const row of sorted) {
    const key = row.entry.jobId ?? row.entry.jobTitle ?? "?";
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, title: row.entry.jobTitle ?? "", rows: [], best: null };
      groups.push(g);
    }
    g.rows.push(row);
    if (row.score != null && (g.best == null || row.score > g.best)) g.best = row.score;
  }
  return groups;
}
