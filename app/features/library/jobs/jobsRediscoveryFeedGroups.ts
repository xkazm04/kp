// The silver-medalist feed, cut around the PERSON (challenge-r08
// candidate-rediscovery/B). Alerts are stored one row per person x role, so a
// strong past candidate who clears four open roles used to be four rows in
// insertion order, and the feed's outcome state was keyed by person: adding her to
// one role painted "Added" on the other three and refused to file her there.
//
// Pure, no React: the hook derives groups from the unchanged flat Alert[] (so the
// reversible dismiss in jobsRediscoveryDismiss.ts keeps operating on rows), and
// every outcome is keyed by the PAIR it was answered for. The one exception is an
// anonymization refusal, which is a fact about the person, not the role.
import { byPriorAwareRank } from "@/app/_lib/rediscovery-rank";
import type { ReachOutResult } from "@/app/_lib/useReachOut";
import type { Alert } from "./jobsRediscoveryFeedTypes";

export type PersonGroup = {
  candidateId: string;
  label: string;
  /** Her qualifying roles, best first by the panel's prior-aware comparator. */
  roles: Alert[];
  best: Alert;
};

/** `prior.depth` IS the band-limited boost (priorDepthBoost, stored at raise
 *  time). Legacy rows carry null: they rank on their honest score alone. */
function rankOf(a: Alert): { score: number; boost: number } {
  const d = a.prior.depth;
  return { score: a.score, boost: typeof d === "number" && Number.isFinite(d) ? d : 0 };
}

const byRank = (a: Alert, b: Alert) => byPriorAwareRank(rankOf(a), rankOf(b));

export function groupAlertsByPerson(alerts: readonly Alert[]): PersonGroup[] {
  const byPerson = new Map<string, Alert[]>();
  for (const a of alerts) {
    const list = byPerson.get(a.candidateId);
    if (list) list.push(a);
    else byPerson.set(a.candidateId, [a]);
  }
  const groups: PersonGroup[] = [];
  for (const [candidateId, list] of byPerson) {
    const roles = [...list].sort(byRank);
    groups.push({ candidateId, label: roles[0].label, roles, best: roles[0] });
  }
  return groups.sort((a, b) => byRank(a.best, b.best));
}

export type PairStatus = "open" | "pending" | "added" | "reached" | "withheld" | "error";

/** Pair outcomes, plus the people withheld as a whole (anonymized). Two maps, so
 *  a person key can never collide with a pair key. */
export type Outcomes = {
  readonly pairs: ReadonlyMap<string, PairStatus>;
  readonly people: ReadonlySet<string>;
};

export const emptyOutcomes = (): Outcomes => ({ pairs: new Map(), people: new Set() });

export const pairKey = (candidateId: string, jobId: string) => JSON.stringify([candidateId, jobId]);

/** Set one pair's status; "open" clears it. Returns a new value (React state). */
export function markPair(s: Outcomes, candidateId: string, jobId: string, status: PairStatus): Outcomes {
  const pairs = new Map(s.pairs);
  if (status === "open") pairs.delete(pairKey(candidateId, jobId));
  else pairs.set(pairKey(candidateId, jobId), status);
  return { pairs, people: s.people };
}

/** Withhold every role of one person. Scoped to anonymization: an erased person
 *  is erased for every role, while a lapsed consent or a stopped sequence is
 *  answered per entry and stays on its pair. */
export function markPerson(s: Outcomes, candidateId: string): Outcomes {
  return { pairs: s.pairs, people: new Set(s.people).add(candidateId) };
}

export function pairStatus(s: Outcomes, candidateId: string, jobId: string): PairStatus {
  if (s.people.has(candidateId)) return "withheld";
  return s.pairs.get(pairKey(candidateId, jobId)) ?? "open";
}

/** A pair a click may still act on: untouched, or failed (the click is a retry). */
export const isActionable = (status: PairStatus) => status === "open" || status === "error";

/** Fold a Reach-out verdict into the outcomes. Both OK verdicts leave the person
 *  filed and contacted for THIS role ("already_sent" included), so the pair is
 *  done; only an anonymization refusal reaches past the pair. */
export function applyReachOut(s: Outcomes, candidateId: string, jobId: string, result: ReachOutResult): Outcomes {
  if (result.ok) return markPair(s, candidateId, jobId, "reached");
  if (result.suppression === "anonymized") return markPerson(s, candidateId);
  if (result.suppression) return markPair(s, candidateId, jobId, "withheld");
  return markPair(s, candidateId, jobId, "error");
}

export type GroupView = {
  /** The best role still offered (pending included, so its spinner stays put). */
  next: Alert | null;
  /** The other roles still offered, in rank order. */
  rest: Alert[];
  /** Roles already filed or contacted in this session. */
  done: Alert[];
  /** Roles the server refused to contact her for. */
  withheld: Alert[];
};

export function groupView(group: PersonGroup, s: Outcomes): GroupView {
  const live: Alert[] = [];
  const done: Alert[] = [];
  const withheld: Alert[] = [];
  for (const a of group.roles) {
    const st = pairStatus(s, a.candidateId, a.jobId);
    if (st === "added" || st === "reached") done.push(a);
    else if (st === "withheld") withheld.push(a);
    else live.push(a);
  }
  return { next: live[0] ?? null, rest: live.slice(1), done, withheld };
}
