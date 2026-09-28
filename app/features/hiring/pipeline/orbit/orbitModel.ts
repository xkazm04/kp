/*
 * The Orbit's model (Hiring > Pipeline, the /contest pipeline-l0-l1 winner "The Orbit", promoted behind
 * the pipeline's view switcher). Pure: every number the orbit, the lanes and the ladders draw is derived
 * here, once, from the board payload the tab already holds plus the job list (for what the entries do
 * not carry: location, seniority, status, target, and the roles nobody is on yet).
 *
 * Absence stays honest at the source, as the winner kept it:
 *  - a role with nobody active says WHY: "vacant" (open for applications, nobody yet) or "draft";
 *    a CLOSED role with nobody on it is not an open role and is not drawn (counted in `closedEmpty`);
 *  - a candidate whose score is null stays unscored, never 0;
 *  - stageChangedAt null means "placed, never moved" (`walked: false`), the product's walked/placed split;
 *  - a role with no target has `target: null`, not 0.
 * Aging is the product's one clock (the caller hands in the tab's `isStale`), so the orbit ages exactly
 * what the board, the badge and the automation pass age.
 */
import { needsHumanDecision } from "../../../../_lib/approval-kinds.ts";
import type { StageDef } from "../../../../_lib/pipeline-stages.ts";
import { entryLaneKey, type Entry } from "../../../shared/pipelineTypes.ts";

/** The slice of GET /api/jobs the orbit reads. */
export type OrbitJob = {
  id: string;
  title: string;
  roleFamily?: string | null;
  location?: string | null;
  seniority?: string | null;
  status?: string | null;
  targetHires?: number | null;
};

export const ABSENCES = ["vacant", "draft"] as const;
export type Absence = (typeof ABSENCES)[number];

export const LENSES = ["family", "city", "seniority"] as const;
export type LensId = (typeof LENSES)[number];
export function isLens(v: unknown): v is LensId {
  return typeof v === "string" && (LENSES as readonly string[]).includes(v);
}
/** The group a role has no value for, under any lens. */
export const NONE = "__none";

export type StageCount = { n: number; wait: number; aging: number };

export type OrbitPerson = {
  id: string;
  entry: Entry;
  name: string;
  role: OrbitRole;
  /** Index on the axis. Off-axis people are not drawn (the "Off the board" section names them). */
  si: number;
  score: number | null;
  walked: boolean;
  /** The approval kind a human must act on, else null. */
  waiting: string | null;
  aging: boolean;
  terminal: boolean;
};

export type OrbitRole = {
  key: string;
  title: string;
  job: OrbitJob | null;
  family: string | null;
  city: string | null;
  seniority: string | null;
  status: string | null;
  target: number | null;
  people: OrbitPerson[];
  st: StageCount[];
  act: number;
  wait: number;
  aging: number;
  hired: number;
  waitKinds: Record<string, number>;
  absence: Absence | null;
  lastMove: string | null;
};

export type OrbitGroup = {
  key: string;
  lens: LensId;
  roles: OrbitRole[];
  act: number;
  wait: number;
  aging: number;
  hired: number;
  target: number;
  live: number;
  abs: Record<Absence, number>;
  st: StageCount[];
  attention: number;
};

export type OrbitModel = {
  axis: readonly StageDef[];
  roles: OrbitRole[];
  people: OrbitPerson[];
  byId: Map<string, OrbitPerson>;
  roleByKey: Map<string, OrbitRole>;
  total: OrbitGroup;
  /** Closed roles with nobody active: not open roles, so not drawn. */
  closedEmpty: number;
};

type BuildInput = {
  /** The board's live population (real rows, active status). */
  entries: readonly Entry[];
  jobs: readonly OrbitJob[] | null;
  axis: readonly StageDef[];
  isStale: (e: Entry) => boolean;
  score: (e: Entry) => number | null;
};

const SEN_ORDER: Record<string, number> = { junior: 0, medior: 1, senior: 2, lead: 3 };

/** "Praha – Michle" and "Praha" are one city; "Remote (CZ)" stays itself. */
export function cityOf(location: string | null | undefined): string | null {
  const loc = (location ?? "").trim();
  if (!loc) return null;
  if (/^remote/i.test(loc)) return loc;
  return loc.split(/\s[–-]\s/)[0].trim() || null;
}

const blankStages = (axis: readonly StageDef[]): StageCount[] => axis.map(() => ({ n: 0, wait: 0, aging: 0 }));

function newRole(key: string, title: string, job: OrbitJob | null, family: string | null, axis: readonly StageDef[]): OrbitRole {
  return {
    key, title, job, family,
    city: cityOf(job?.location), seniority: job?.seniority ?? null, status: job?.status ?? null,
    target: job?.targetHires ?? null,
    people: [], st: blankStages(axis), act: 0, wait: 0, aging: 0, hired: 0, waitKinds: {}, absence: null, lastMove: null,
  };
}

/** Who needs a human first, then who is over their stage's cadence, then everyone else. */
export function attentionRank(p: Pick<OrbitPerson, "waiting" | "aging">): number {
  return p.waiting ? 0 : p.aging ? 1 : 2;
}

export function buildOrbit({ entries, jobs, axis, isStale, score }: BuildInput): OrbitModel {
  const jobById = new Map((jobs ?? []).map((j) => [j.id, j]));
  const roleByKey = new Map<string, OrbitRole>();
  const people: OrbitPerson[] = [];
  const at = new Map(axis.map((s, i) => [s.id, i]));

  for (const e of entries) {
    const key = entryLaneKey(e);
    let role = roleByKey.get(key);
    if (!role) {
      const job = e.jobId ? jobById.get(e.jobId) ?? null : null;
      role = newRole(key, e.jobTitle ?? job?.title ?? key, job, e.roleFamily ?? job?.roleFamily ?? null, axis);
      roleByKey.set(key, role);
    }
    const moved = e.stageChangedAt ?? e.createdAt;
    if (moved && (!role.lastMove || moved > role.lastMove)) role.lastMove = moved;
    const si = at.get(e.stage);
    if (si == null) continue;
    const terminal = axis[si].role === "terminal";
    const waiting = needsHumanDecision(e.approvalKind) ? e.approvalKind : null;
    const aging = !terminal && isStale(e);
    const p: OrbitPerson = { id: e.id, entry: e, name: e.candidateLabel, role, si, score: score(e), walked: e.stageChangedAt != null, waiting, aging, terminal };
    people.push(p);
    role.people.push(p);
    role.act++;
    const st = role.st[si];
    st.n++;
    if (waiting) { st.wait++; role.wait++; role.waitKinds[waiting] = (role.waitKinds[waiting] ?? 0) + 1; }
    if (aging) { st.aging++; role.aging++; }
    if (terminal) role.hired++;
  }

  let closedEmpty = 0;
  for (const job of jobs ?? []) {
    if (roleByKey.has(job.id)) continue;
    if (job.status === "closed") { closedEmpty++; continue; }
    const role = newRole(job.id, job.title, job, job.roleFamily ?? null, axis);
    role.absence = job.status === "draft" ? "draft" : "vacant";
    roleByKey.set(job.id, role);
  }

  const roles = [...roleByKey.values()];
  for (const r of roles) {
    if (r.act === 0 && !r.absence) r.absence = r.status === "draft" ? "draft" : "vacant";
    r.people.sort((a, b) => a.si - b.si || attentionRank(a) - attentionRank(b) || (b.score ?? -1) - (a.score ?? -1));
  }
  roles.sort(roleOrder);
  const total = aggregate("__all", "family", roles, axis);
  return { axis, roles, people, byId: new Map(people.map((p) => [p.id, p])), roleByKey, total, closedEmpty };
}

/** Live roles first (most waiting, most late, most people), then the empty ones by why they are empty. */
export function roleOrder(a: OrbitRole, b: OrbitRole): number {
  const az = a.act === 0 ? 1 : 0;
  const bz = b.act === 0 ? 1 : 0;
  if (az !== bz) return az - bz;
  if (az) return ABSENCES.indexOf(a.absence ?? "vacant") - ABSENCES.indexOf(b.absence ?? "vacant") || a.title.localeCompare(b.title);
  return b.wait - a.wait || b.aging - a.aging || b.act - a.act || a.title.localeCompare(b.title);
}

function aggregate(key: string, lens: LensId, roles: OrbitRole[], axis: readonly StageDef[]): OrbitGroup {
  const g: OrbitGroup = {
    key, lens, roles: [...roles].sort(roleOrder), act: 0, wait: 0, aging: 0, hired: 0, target: 0, live: 0,
    abs: { vacant: 0, draft: 0 }, st: blankStages(axis), attention: 0,
  };
  for (const r of roles) {
    g.act += r.act; g.wait += r.wait; g.aging += r.aging; g.hired += r.hired;
    if (r.target != null) g.target += r.target;
    if (r.absence) g.abs[r.absence]++; else g.live++;
    r.st.forEach((s, i) => { g.st[i].n += s.n; g.st[i].wait += s.wait; g.st[i].aging += s.aging; });
  }
  g.attention = g.wait * 1_000_000 + g.aging * 1000 + g.act;
  return g;
}

export function lensKey(role: OrbitRole, lens: LensId): string {
  const v = lens === "family" ? role.family : lens === "city" ? role.city : role.seniority;
  return v || NONE;
}

/** The groups under one lens: most attention first; seniority keeps its own ladder order. */
export function groupsFor(model: OrbitModel, lens: LensId): OrbitGroup[] {
  const buckets = new Map<string, OrbitRole[]>();
  for (const r of model.roles) {
    const k = lensKey(r, lens);
    buckets.set(k, [...(buckets.get(k) ?? []), r]);
  }
  const list = [...buckets].map(([k, rs]) => aggregate(k, lens, rs, model.axis));
  list.sort((a, b) => b.attention - a.attention || a.key.localeCompare(b.key));
  if (lens === "seniority") list.sort((a, b) => (SEN_ORDER[a.key] ?? 9) - (SEN_ORDER[b.key] ?? 9));
  return list;
}

/** Most waiting first, then most late, then most people: the order the orbit places sectors from 12 o'clock. */
export function byUrgency(a: OrbitGroup, b: OrbitGroup): number {
  return b.wait - a.wait || b.aging - a.aging || b.act - a.act || a.key.localeCompare(b.key);
}

/** A candidate's first name: the first word of the label. */
export function firstName(label: string): string {
  return label.trim().split(/\s+/)[0] ?? "";
}

/**
 * The ladder order (the owner's rule, 2026-09-28): scored candidates by score, highest first; the
 * unscored after them by first name, A to Z. Ties fall back to the full name so the order is stable.
 */
export function ladderCompare(locale: string) {
  const coll = new Intl.Collator(locale, { sensitivity: "base" });
  return (a: OrbitPerson, b: OrbitPerson): number => {
    if (a.score != null && b.score != null) return b.score - a.score || coll.compare(a.name, b.name);
    if (a.score != null) return -1;
    if (b.score != null) return 1;
    return coll.compare(firstName(a.name), firstName(b.name)) || coll.compare(a.name, b.name);
  };
}

export type LadderRung = { si: number; stage: StageDef; people: OrbitPerson[] };

/** One role's ladder: a rung per stage, each in ladder order. `stage` narrows it to one rung. */
export function ladderOf(role: OrbitRole, axis: readonly StageDef[], locale: string, stage: string | null = null): LadderRung[] {
  const cmp = ladderCompare(locale);
  return axis
    .map((st, si) => ({ si, stage: st, people: role.people.filter((p) => p.si === si).sort(cmp) }))
    .filter((r) => stage == null || r.stage.id === stage);
}

/** The ladder's people in reading order (rung by rung): the candidate modal's prev/next cohort. */
export function ladderPeople(rungs: readonly LadderRung[]): OrbitPerson[] {
  return rungs.flatMap((r) => r.people);
}

/* ---------------------------------------------------------------- search */

export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export type SearchHit = { type: "role"; role: OrbitRole } | { type: "person"; person: OrbitPerson; role: OrbitRole };

/** Every term must appear; a title or a name that STARTS with the query ranks first. */
export function searchOrbit(model: OrbitModel, query: string, limit = 12): SearchHit[] {
  const q = fold(query).trim();
  if (!q) return [];
  const terms = q.split(/\s+/);
  const hit = (k: string) => terms.every((t) => k.includes(t));
  const out: { h: SearchHit; rank: number }[] = [];
  for (const r of model.roles) {
    const k = fold(`${r.title} ${r.job?.location ?? ""}`);
    if (hit(k)) out.push({ h: { type: "role", role: r }, rank: fold(r.title).startsWith(q) ? 0 : 1 });
  }
  for (const p of model.people) {
    const k = fold(p.name);
    if (hit(k)) out.push({ h: { type: "person", person: p, role: p.role }, rank: k.startsWith(q) ? 2 : 3 });
  }
  const roleOf = (h: SearchHit) => h.role;
  out.sort((a, b) => a.rank - b.rank || roleOf(b.h).wait - roleOf(a.h).wait);
  return out.slice(0, limit).map((x) => x.h);
}
