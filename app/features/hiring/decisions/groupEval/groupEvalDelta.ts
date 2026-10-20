// What changed between two group evaluations, stated only as far as the two records
// support it. Pure (no React) so every claim the modal makes has test reach.
//
// Two moments ask this question:
//   • poolChange  — a SAVED comparison is opened and the role's pending pool has moved
//                   since it ran: WHO joined and WHO left, not just how many.
//   • rerunDelta  — the recruiter re-ran the comparison: did the lead change, and who
//                   moved in the order.
//
// The rule both obey (registry recruiting/comparative-shortlist-evaluation, "the
// comparison is bound to the pool it compared"): second place in a field of four and
// second place in a field of seven are different facts. So a rank move is computed
// ONLY over the candidates compared both times, by their order among themselves, and
// a new lead that sits inside the runner-up's confidence band is reported as a tie,
// never as a change of lead.
import { candIdentity, type GroupEvalPayload } from "@/app/features/shared/groupEvalTypes";

export type PoolChange = { joined: string[]; left: string[] };

/** Who joined and who left the role's pending pool since the evaluation ran, as
 *  display labels. Keyed by entry id when the payload recorded ids with a parallel
 *  label list; by label for a legacy payload that recorded labels only. `null` when
 *  the payload cannot name the people (neither list, or ids without labels): the
 *  notice then keeps its count-only sentence rather than inventing a name. */
export function poolChange(
  payload: Pick<GroupEvalPayload, "evaluatedIds" | "evaluatedLabels"> | null | undefined,
  entries: readonly { id: string; label: string }[]
): PoolChange | null {
  if (!payload) return null;
  const ids = payload.evaluatedIds;
  const labels = payload.evaluatedLabels;
  if (ids && ids.length > 0) {
    // Without a label per id, who LEFT has no name on record.
    if (!labels || labels.length !== ids.length) return null;
    const was = new Map(ids.map((id, i) => [id, labels[i]] as const));
    const now = new Set(entries.map((e) => e.id));
    return {
      joined: entries.filter((e) => !was.has(e.id)).map((e) => e.label),
      left: ids.filter((id) => !now.has(id)).map((id) => was.get(id) as string),
    };
  }
  if (labels) {
    const was = new Set(labels);
    const now = new Set(entries.map((e) => e.label));
    return {
      joined: [...now].filter((l) => !was.has(l)),
      left: [...was].filter((l) => !now.has(l)),
    };
  }
  return null;
}

export type GovernanceModeName = NonNullable<GroupEvalPayload["governanceMode"]>;

export type LeadChange = {
  from: string | null;
  to: string | null;
  fromId: string | null;
  toId: string | null;
  /** `no_lead`: this run crowned nobody (committee mode, a sub-floor cohort) — the
   *  previous lead did not LOSE anything. `within_band`: the two leads sit inside a
   *  confidence band, so the swap is a tie on the evidence, not a change of lead. */
  reason?: "no_lead" | "within_band";
};

export type RankMove = { id: string; label: string; from: number; to: number };

export type RerunDelta = {
  /** The set of candidates compared differs between the two runs. */
  fieldChanged: boolean;
  entered: string[];
  dropped: string[];
  /** How many candidates were compared both times — the only field a move is about. */
  common: number;
  /** null when both runs crowned the same lead (or neither crowned one). */
  lead: LeadChange | null;
  /** Rank changes among the common members only, 1-based, in the NEW order. */
  moves: RankMove[];
  modeChanged: boolean;
  mode: { from: GovernanceModeName; to: GovernanceModeName };
  /** Same field, same lead, same order, same mode. */
  unchanged: boolean;
};

const leadId = (p: GroupEvalPayload): string | null => (p.topPick ? p.topPick.entryId ?? p.topPick.label : null);

/** The delta a Re-run produced. `null` when there is no previous run to compare with
 *  (a first run or a cache open shows no strip). */
export function rerunDelta(prev: GroupEvalPayload | null | undefined, next: GroupEvalPayload | null | undefined): RerunDelta | null {
  if (!prev || !next) return null;
  const prevC = prev.candidates ?? [];
  const nextC = next.candidates ?? [];
  const prevIds = prevC.map(candIdentity);
  const nextIds = nextC.map(candIdentity);
  const prevSet = new Set(prevIds);
  const nextSet = new Set(nextIds);

  const entered = nextC.filter((c) => !prevSet.has(candIdentity(c))).map((c) => c.label);
  const dropped = prevC.filter((c) => !nextSet.has(candIdentity(c))).map((c) => c.label);
  const fieldChanged = entered.length > 0 || dropped.length > 0;

  // Ranks WITHIN the common members, so a newcomer slotting in above someone is not
  // reported as that someone "falling".
  const prevCommon = prevIds.filter((id) => nextSet.has(id));
  const prevRank = new Map(prevCommon.map((id, i) => [id, i + 1] as const));
  const moves: RankMove[] = [];
  let rank = 0;
  for (const c of nextC) {
    const id = candIdentity(c);
    const from = prevRank.get(id);
    if (from === undefined) continue;
    rank += 1;
    if (from !== rank) moves.push({ id, label: c.label, from, to: rank });
  }

  const fromId = leadId(prev);
  const toId = leadId(next);
  let lead: LeadChange | null = null;
  if (fromId !== toId) {
    lead = { from: prev.topPick?.label ?? null, to: next.topPick?.label ?? null, fromId, toId };
    if (toId === null) lead.reason = "no_lead";
    else if (fromId !== null && (next.leadSeparation === "overlapping" || prev.leadSeparation === "overlapping")) {
      lead.reason = "within_band";
    }
  }

  const mode = { from: prev.governanceMode ?? "recommendation", to: next.governanceMode ?? "recommendation" };
  const modeChanged = mode.from !== mode.to;

  return {
    fieldChanged,
    entered,
    dropped,
    common: prevCommon.length,
    lead,
    moves,
    modeChanged,
    mode,
    unchanged: !fieldChanged && lead === null && moves.length === 0 && !modeChanged,
  };
}

/** A name list capped for one sentence: the first `max` names and how many more. */
export function capNames(names: readonly string[], max = 5): { shown: string[]; more: number } {
  return { shown: names.slice(0, max), more: Math.max(0, names.length - max) };
}
