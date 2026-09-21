// Client-side prior-kind filter for the on-demand rediscover list. The three
// kinds already have distinct chips; this lets a recruiter isolate "we closed
// when the req died" from "we rejected them" without a new spawn.

export const REDISCOVER_KINDS = ["rejected", "closed", "elsewhere"] as const;
export type RediscoverKind = (typeof REDISCOVER_KINDS)[number];
export type KindFilter = Record<RediscoverKind, boolean>;

export const ALL_KINDS_ON: KindFilter = { rejected: true, closed: true, elsewhere: true };

export function isRediscoverKind(value: string): value is RediscoverKind {
  return (REDISCOVER_KINDS as readonly string[]).includes(value);
}

export function toggleKind(filter: KindFilter, kind: RediscoverKind): KindFilter {
  return { ...filter, [kind]: !filter[kind] };
}

export function kindFilterEmpty(filter: KindFilter): boolean {
  return REDISCOVER_KINDS.every((k) => !filter[k]);
}

export function filterRediscoverByKind<T extends { prior: { kind: string } }>(rows: T[], filter: KindFilter): T[] {
  return rows.filter((r) => isRediscoverKind(r.prior.kind) && filter[r.prior.kind]);
}
