import { normalizeNicheLabel } from "@/app/_lib/gigs/match";
import type { GigArena, GigKpi, GigKpiCell } from "@/app/_lib/gigs/types";
import type { SpecialistRow } from "./wire";

// ---------------------------------------------------------------------------
// Specialists, folded into niches
// ---------------------------------------------------------------------------

/** Hire states in the order a niche's lead is picked: a working hire before one on its
 *  way, before a retired or failed one. Unknown states sort last. */
const HIRE_RANK: Readonly<Record<string, number>> = { active: 0, onboarding: 1, pending_approval: 2, dispatched: 3, retired: 4, failed: 5, rejected: 6 };
const hireRank = (s: SpecialistRow) => (s.hire ? (HIRE_RANK[s.hire.status] ?? 7) : 8);

export type Niche = {
  /** `arena|niche`, the niche normalized the way match.ts compares niches. */
  key: string;
  arena: GigArena;
  /** The niche as the lead hire states it. */
  label: string;
  /** Every hire of this niche, lead first. */
  hires: SpecialistRow[];
  lead: SpecialistRow;
  earlier: SpecialistRow[];
};

export function nicheKeyOf(s: Pick<SpecialistRow, "spec">): string {
  return `${s.spec.arena}|${normalizeNicheLabel(s.spec.niche)}`;
}

/** 13 hires read as the niches they are: the same niche hired twice or three times is ONE
 *  lane, its working hire leading and the earlier copies folded under it. Ordered by the
 *  lead's hire state, then by label. */
export function foldNiches(specialists: readonly SpecialistRow[]): Niche[] {
  const map = new Map<string, SpecialistRow[]>();
  for (const s of specialists) {
    const k = nicheKeyOf(s);
    map.set(k, [...(map.get(k) ?? []), s]);
  }
  const out = [...map.entries()].map(([key, list]) => {
    const hires = [...list].sort((a, b) => hireRank(a) - hireRank(b) || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? -1 : 1));
    return { key, arena: hires[0].spec.arena, label: hires[0].spec.niche, hires, lead: hires[0], earlier: hires.slice(1) };
  });
  return out.sort((a, b) => hireRank(a.lead) - hireRank(b.lead) || a.label.localeCompare(b.label));
}

export function nicheBySpecialistMap(niches: readonly Niche[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of niches) for (const h of n.hires) m.set(h.id, n.key);
  return m;
}

/** A niche's KPI: its hires' cells summed. The cells partition the sent attempts (each
 *  attempt belongs to exactly one specialist), so the sum is honest; the rate re-derives
 *  from the sums and stays null while nothing is resolved. Cost per accepted is kept only
 *  when every hire that won something reported it. */
export function nicheCell(niche: Pick<Niche, "hires">, kpi: Pick<GigKpi, "bySpecialist"> | null): GigKpiCell {
  let resolved = 0;
  let accepted = 0;
  let pending = 0;
  let costUnreported = 0;
  let spend = 0;
  let spendKnown = true;
  for (const h of niche.hires) {
    const c = kpi?.bySpecialist[h.id];
    if (!c) continue;
    resolved += c.resolved;
    accepted += c.accepted;
    pending += c.pending;
    costUnreported += c.costUnreported;
    if (c.accepted > 0) {
      if (c.costPerAcceptedUsd === null) spendKnown = false;
      else spend += c.costPerAcceptedUsd * c.accepted;
    }
  }
  return {
    resolved,
    accepted,
    pending,
    rate: resolved === 0 ? null : accepted / resolved,
    costPerAcceptedUsd: accepted > 0 && spendKnown ? spend / accepted : null,
    costUnreported,
    smallSample: resolved < 10,
  };
}

/** One specialist's whole attempt record, as GET /api/gigs/specialists `tallies` serves it
 *  (db/gigs-attempts.ts gigAttemptTallies). */
export type AttemptTally = { attempts: number; byStatus: Partial<Record<string, number>>; costUsd: number; costUnreported: number };

/** A niche's attempt record: its hires' tallies summed. */
export function nicheTally(niche: Pick<Niche, "hires">, tallies: Readonly<Record<string, AttemptTally>> | null): AttemptTally {
  const out: AttemptTally = { attempts: 0, byStatus: {}, costUsd: 0, costUnreported: 0 };
  for (const h of niche.hires) {
    const t = tallies?.[h.id];
    if (!t) continue;
    out.attempts += t.attempts;
    out.costUsd += t.costUsd;
    out.costUnreported += t.costUnreported;
    for (const [k, v] of Object.entries(t.byStatus)) out.byStatus[k] = (out.byStatus[k] ?? 0) + (v ?? 0);
  }
  return out;
}

/** The whole program's attempt record (Reception). */
export function programTally(tallies: Readonly<Record<string, AttemptTally>> | null): AttemptTally {
  return nicheTally({ hires: Object.keys(tallies ?? {}).map((id) => ({ id }) as SpecialistRow) }, tallies);
}
