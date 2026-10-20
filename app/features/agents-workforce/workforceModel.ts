// The Clock Wheel's model (pure, no React, no next-intl; pinned by workforceModel.test.ts). Everything
// the Time-Card Rack draws is derived here from the roster rows GET /api/agents serves and the moves
// agentsWorkforceLogic.nextAction already decided; the view components only map these values to words.
//
// The drawing groups hires into DRAWERS. The prototype grouped by a hand-made "role family", which the
// product row does not have, so a drawer here is something the row really carries: the role a hire was
// dispatched for (jobId + jobTitle), plus two fixed ones: gig hires (no job, not an App master) and App
// masters (they own an application, not a role). The wheel's size must not depend on the roster, so the
// number of role drawers is capped and the rest fold into one "more roles" drawer.
import type { AgentStatus } from "@/app/_lib/db/agents";
import type { Condition } from "@/app/_components/kit/scene";
import {
  BACKBONE_MARK, NEXT_ACTION_CONTROL, expectationsVerdict, metricsOf,
  type AgentRosterEntry, type ExpectationsVerdict, type MarkState, type NextAction, type NextActionKind,
} from "./agentsWorkforceLogic.ts";

// ---- a hire's state -----------------------------------------------------------

/** What the wheel shows a hire as: one of six readings (the brief's "living things in a state"). */
export const PHASES = ["cutoff", "stuck", "waiting", "probation", "working", "out"] as const;
export type Phase = (typeof PHASES)[number];

/** The bridge outranks everything (nothing can move without it), then a hire that is stuck, waiting, ... */
export function phaseOf(agent: AgentRosterEntry, move: NextAction): Phase {
  if (move.kind === "repair_bridge") return "cutoff";
  if (move.kind === "approval_lapsed" || move.kind === "check_reporter" || move.kind === "redispatch") return "stuck";
  switch (agent.status) {
    case "dispatched":
    case "pending_approval":
      return "waiting";
    case "onboarding":
      return "probation";
    case "active":
      return "working";
    case "failed":
      return "stuck";
    case "rejected":
    case "retired":
      return "out";
  }
}

/** The kit condition each lifecycle status wears (shape and words, never colour alone). */
export const STATUS_CONDITION: Record<AgentStatus, Condition> = {
  dispatched: "wait",
  pending_approval: "wait",
  onboarding: "reach",
  active: "live",
  rejected: "off",
  failed: "fail",
  retired: "off",
};

/** The lifecycle a hire walks, then the exits that leave it (kept as the record). */
export const LIFE_STEPS = ["dispatched", "pending_approval", "onboarding", "active"] as const satisfies readonly AgentStatus[];
export const EXIT_STEPS = ["failed", "rejected", "retired"] as const satisfies readonly AgentStatus[];

export function isLive(agent: AgentRosterEntry): boolean {
  return agent.status !== "retired" && agent.status !== "rejected";
}

export function needsYou(move: NextAction): boolean {
  return move.kind !== "none";
}

/** The short id a time card is numbered by (the hash tail of the row id). */
export function cardNo(agent: AgentRosterEntry): string {
  const tail = agent.id.split("-").pop() ?? agent.id;
  return tail.toUpperCase();
}

/** The one control a move puts on a card, or null (nothing needs the operator). */
export function controlOf(move: NextAction): "refresh" | "redispatch" | "integrations" | "explain" | null {
  return NEXT_ACTION_CONTROL[move.kind];
}

// ---- spend --------------------------------------------------------------------

export type SpendTone = "under" | "near" | "over" | "unknown";
export type Spend = {
  month: number;
  budget: number | null;
  lifetime: number;
  /** month / budget; null with no budget to compare against. */
  frac: number | null;
  /** Nothing has ever been costed: the provider reports $0 on subscription auth, which is not a measured zero. */
  unmeasured: boolean;
  tone: SpendTone;
};

export function spendOf(agent: AgentRosterEntry): Spend {
  const g = agent.aggregates;
  const budget = agent.budgetUsd != null && agent.budgetUsd > 0 ? agent.budgetUsd : null;
  const frac = budget == null ? null : g.monthCostUsd / budget;
  return {
    month: g.monthCostUsd,
    budget,
    lifetime: g.costUsd,
    frac,
    unmeasured: !(g.costUsd > 0),
    tone: frac == null ? "unknown" : frac >= 1 ? "over" : frac >= 0.8 ? "near" : "under",
  };
}

// ---- the next move, ranked ----------------------------------------------------

const PRIORITY: readonly NextActionKind[] = ["repair_bridge", "approval_lapsed", "approve_in_personas", "review_probation", "check_reporter", "redispatch"];

function rankOf(move: NextAction): number {
  const i = PRIORITY.indexOf(move.kind);
  return i < 0 ? 99 : i;
}

export type Moves = ReadonlyMap<string, NextAction>;

function moveOf(moves: Moves, agent: AgentRosterEntry): NextAction {
  return moves.get(agent.id) ?? { kind: "none" };
}

function hoursOf(move: NextAction): number {
  return move.kind === "approve_in_personas" && move.hoursLeft != null ? move.hoursLeft : 99;
}

/** The most urgent first: the product's declared priority, then the soonest approval clock, then name. */
export function byUrgency(moves: Moves) {
  return (x: AgentRosterEntry, y: AgentRosterEntry): number => {
    const mx = moveOf(moves, x);
    const my = moveOf(moves, y);
    return rankOf(mx) - rankOf(my) || hoursOf(mx) - hoursOf(my) || nameOf(x).localeCompare(nameOf(y));
  };
}

export function nameOf(agent: AgentRosterEntry): string {
  const spec = agent.spec as { name?: string } | null;
  return agent.personaName ?? (spec?.name || agent.jobTitle);
}

export function missionOf(agent: AgentRosterEntry): string | null {
  const m = (agent.spec as { mission?: string } | null)?.mission;
  return typeof m === "string" && m ? m : null;
}

/** Hires that need the operator, most urgent first; optionally one kind only. */
export function needing(agents: readonly AgentRosterEntry[], moves: Moves, kind?: NextActionKind | null): AgentRosterEntry[] {
  return agents.filter((a) => needsYou(moveOf(moves, a)) && (!kind || moveOf(moves, a).kind === kind)).sort(byUrgency(moves));
}

// ---- drawers ------------------------------------------------------------------

export const MAX_ROLE_DRAWERS = 6;

export type DrawerKey = "appmaster" | "gigs" | "other" | `job:${string}`;
export type DrawerKind = "role" | "other" | "gigs" | "appmaster";

export type Drawer = {
  key: DrawerKey;
  kind: DrawerKind;
  /** The role's title for a role drawer; null for the three fixed ones (the view words them). */
  title: string | null;
  agents: AgentRosterEntry[];
  count: number;
  need: number;
  month: number;
  /** The live hires' monthly budgets, summed. */
  budget: number;
  frac: number | null;
  byPhase: Partial<Record<Phase, number>>;
  /** Hires with nothing ever costed (not $0). */
  unmeasured: number;
};

function drawerKeyOf(agent: AgentRosterEntry): DrawerKey {
  if (agent.appMaster) return "appmaster";
  if (!agent.jobId) return "gigs";
  return `job:${agent.jobId}`;
}

function describe(key: DrawerKey, kind: DrawerKind, title: string | null, agents: AgentRosterEntry[], moves: Moves): Drawer {
  const live = agents.filter(isLive);
  const month = agents.reduce((t, a) => t + a.aggregates.monthCostUsd, 0);
  const budget = live.reduce((t, a) => t + (a.budgetUsd ?? 0), 0);
  const byPhase: Partial<Record<Phase, number>> = {};
  for (const a of agents) {
    const p = phaseOf(a, moveOf(moves, a));
    byPhase[p] = (byPhase[p] ?? 0) + 1;
  }
  return {
    key, kind, title, agents, count: agents.length,
    need: agents.filter((a) => needsYou(moveOf(moves, a))).length,
    month, budget, frac: budget > 0 ? month / budget : null, byPhase,
    unmeasured: agents.filter((a) => !(a.aggregates.costUsd > 0)).length,
  };
}

/**
 * The drawers, in the order the wheel stands them: role drawers (the ones that need the operator
 * first, then the larger), then "more roles", then gig hires, then App masters. At most
 * MAX_ROLE_DRAWERS + 3 of them, whatever the roster's size: legibility must not grow with the data.
 */
export function groupDrawers(agents: readonly AgentRosterEntry[], moves: Moves): Drawer[] {
  const by = new Map<DrawerKey, AgentRosterEntry[]>();
  for (const a of agents) {
    const k = drawerKeyOf(a);
    const list = by.get(k);
    if (list) list.push(a);
    else by.set(k, [a]);
  }
  const roles = [...by.entries()]
    .filter(([k]) => k.startsWith("job:"))
    .map(([k, list]) => describe(k, "role", list[0].jobTitle, list, moves))
    .sort((a, b) => b.need - a.need || b.count - a.count || (a.title ?? "").localeCompare(b.title ?? ""));
  const shown = roles.slice(0, MAX_ROLE_DRAWERS);
  const rest = roles.slice(MAX_ROLE_DRAWERS).flatMap((d) => d.agents);
  const out: Drawer[] = [...shown];
  if (rest.length > 0) out.push(describe("other", "other", null, rest, moves));
  const gigs = by.get("gigs");
  if (gigs) out.push(describe("gigs", "gigs", null, gigs, moves));
  const am = by.get("appmaster");
  if (am) out.push(describe("appmaster", "appmaster", null, am, moves));
  return out;
}

/** The drawer a card stands in (the key `groupDrawers` filed it under). */
export function drawerOf(agent: AgentRosterEntry, drawers: readonly Drawer[]): Drawer | null {
  return drawers.find((d) => d.agents.some((a) => a.id === agent.id)) ?? null;
}

// ---- the wheel ----------------------------------------------------------------

/** The fan: cards stand on the clock's right half, from just past 12 to just before 6 o'clock. */
export const FAN = { a0: 5, a1: 175 } as const;

export type WheelDrawer = Drawer & { a0: number; a1: number; mid: number; pitch: number; sorted: AgentRosterEntry[] };
export type WheelCard = { agent: AgentRosterEntry; drawer: WheelDrawer; theta: number; pitch: number };
export type Wheel = { drawers: WheelDrawer[]; cards: WheelCard[] };

/** Inside a drawer: what needs the operator first (most urgent), then by phase, then by spend share. */
export function sectorOrder(moves: Moves) {
  const urgent = byUrgency(moves);
  return (x: AgentRosterEntry, y: AgentRosterEntry): number => {
    const nx = needsYou(moveOf(moves, x));
    const ny = needsYou(moveOf(moves, y));
    if (nx !== ny) return nx ? -1 : 1;
    if (nx) {
      const u = urgent(x, y);
      if (u) return u;
    }
    const px = PHASES.indexOf(phaseOf(x, moveOf(moves, x)));
    const py = PHASES.indexOf(phaseOf(y, moveOf(moves, y)));
    if (px !== py) return px - py;
    const fx = spendOf(x).frac ?? 0;
    const fy = spendOf(y).frac ?? 0;
    return fy - fx || nameOf(x).localeCompare(nameOf(y));
  };
}

/**
 * Where each drawer and card stands on the fan. A drawer's angle follows its headcount, with a floor
 * so a one-hire drawer can still be hit. Only how closely cards stand changes with the roster: the
 * drawers keep their places, so 14 and 400 hires read the same way.
 */
export function wheelOf(drawers: readonly Drawer[], moves: Moves): Wheel {
  const n = drawers.reduce((t, d) => t + d.count, 0);
  if (drawers.length === 0 || n === 0) return { drawers: [], cards: [] };
  const gap = drawers.length > 1 ? 3 : 0;
  const avail = FAN.a1 - FAN.a0 - gap * (drawers.length - 1);
  const minA = Math.min(11, avail / drawers.length);
  let ang = drawers.map((d) => (d.count / n) * avail);
  for (let it = 0; it < 6; it++) {
    let short = 0;
    let freeW = 0;
    ang.forEach((a, i) => {
      if (a < minA) {
        short += minA - a;
        ang[i] = minA;
      } else freeW += drawers[i].count;
    });
    if (!short) break;
    const takeFrom = freeW;
    ang = ang.map((a, i) => (a > minA ? a - short * (drawers[i].count / takeFrom) : a));
  }
  let cursor: number = FAN.a0;
  const cards: WheelCard[] = [];
  const order = sectorOrder(moves);
  const placed = drawers.map((d, i) => {
    const a0 = cursor;
    const a1 = cursor + ang[i];
    cursor = a1 + gap;
    const sorted = d.agents.slice().sort(order);
    const pad = Math.min(1.4, ang[i] * 0.06);
    const pitch = (ang[i] - 2 * pad) / sorted.length;
    const w: WheelDrawer = { ...d, a0, a1, mid: (a0 + a1) / 2, pitch, sorted };
    sorted.forEach((agent, k) => cards.push({ agent, drawer: w, theta: a0 + pad + pitch * (k + 0.5), pitch }));
    return w;
  });
  return { drawers: placed, cards };
}

// ---- totals, headline, needs --------------------------------------------------

export type Totals = { month: number; budget: number; frac: number | null; unmeasured: number; budgeted: number; live: number };

export function totalsOf(agents: readonly AgentRosterEntry[]): Totals {
  const live = agents.filter(isLive);
  const month = agents.reduce((t, a) => t + a.aggregates.monthCostUsd, 0);
  const budget = live.reduce((t, a) => t + (a.budgetUsd ?? 0), 0);
  return {
    month, budget, frac: budget > 0 ? month / budget : null,
    unmeasured: agents.filter((a) => !(a.aggregates.costUsd > 0)).length,
    budgeted: live.filter((a) => (a.budgetUsd ?? 0) > 0).length,
    live: live.length,
  };
}

export function phaseCounts(agents: readonly AgentRosterEntry[], moves: Moves): Partial<Record<Phase, number>> {
  const by: Partial<Record<Phase, number>> = {};
  for (const a of agents) {
    const p = phaseOf(a, moveOf(moves, a));
    by[p] = (by[p] ?? 0) + 1;
  }
  return by;
}

export type BridgeView = { condition: Condition; state: "paired" | "down" | "never" | "unknown"; lastOkAt: string | null };

/** What the roster knows of the bridge: `unknown` while it is still loading (not evidence of a dead one). */
export function bridgeView(bridge: { paired: boolean; hasKey: boolean; lastOkAt: string | null } | null): BridgeView {
  if (!bridge) return { condition: "unknown", state: "unknown", lastOkAt: null };
  if (bridge.paired) return { condition: "live", state: "paired", lastOkAt: bridge.lastOkAt };
  if (bridge.hasKey) return { condition: "fail", state: "down", lastOkAt: bridge.lastOkAt };
  return { condition: "off", state: "never", lastOkAt: null };
}

// ---- the lifecycle ledger (what the row really carries) -----------------------

export type LedgerEvent = { at: string; kind: "mint" | "pending" | "decision" | "report" | "activity"; event?: string };
export type LedgerAbsence = "never_heard" | "none_accepted";

/** Newest first. Only what the server holds: the mint, the approval stamp, the last applied decision, the
 *  last report heard (accepted or not) and the last accepted activity. The absences are stated, never blank. */
export function ledgerOf(agent: AgentRosterEntry): { events: LedgerEvent[]; absent: LedgerAbsence[] } {
  const events: LedgerEvent[] = [{ at: agent.createdAt, kind: "mint" }];
  if (agent.pendingApprovalSince) events.push({ at: agent.pendingApprovalSince, kind: "pending" });
  if (agent.lastDecision) events.push({ at: agent.lastDecision.at, kind: "decision", event: agent.lastDecision.event });
  if (agent.lastReportAt) events.push({ at: agent.lastReportAt, kind: "report" });
  if (agent.aggregates.lastActivityAt) events.push({ at: agent.aggregates.lastActivityAt, kind: "activity" });
  events.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  const absent: LedgerAbsence[] = [];
  if (!agent.lastReportAt) absent.push("never_heard");
  else if (!agent.aggregates.lastActivityAt) absent.push("none_accepted");
  return { events, absent };
}

// ---- sorting inside a drawer --------------------------------------------------

export const SORTS = ["needs", "spend", "name", "newest"] as const;
export type SortKey = (typeof SORTS)[number];

export function sorter(sort: SortKey, moves: Moves) {
  const urgent = byUrgency(moves);
  switch (sort) {
    case "spend":
      return (x: AgentRosterEntry, y: AgentRosterEntry) => y.aggregates.monthCostUsd - x.aggregates.monthCostUsd || nameOf(x).localeCompare(nameOf(y));
    case "name":
      return (x: AgentRosterEntry, y: AgentRosterEntry) => nameOf(x).localeCompare(nameOf(y));
    case "newest":
      return (x: AgentRosterEntry, y: AgentRosterEntry) => Date.parse(y.createdAt) - Date.parse(x.createdAt) || nameOf(x).localeCompare(nameOf(y));
    case "needs":
      return (x: AgentRosterEntry, y: AgentRosterEntry) => {
        const nx = needsYou(moveOf(moves, x));
        const ny = needsYou(moveOf(moves, y));
        if (nx !== ny) return nx ? -1 : 1;
        return nx ? urgent(x, y) : nameOf(x).localeCompare(nameOf(y));
      };
  }
}

// ---- the verdict a card carries -----------------------------------------------

export type Verdict =
  /** An App master is judged by its deterministic backbone, never by a run-count proxy. */
  | { kind: "backbone"; mark: MarkState; verdict: "pass" | "incomplete" | "fail" | null }
  | { kind: "metrics"; mark: MarkState; v: ExpectationsVerdict };

/** One verdict per hire: a task agent's metrics (no data is neither met nor missed), an App master's backbone
 *  (incomplete is a DASH, never a soft pass; no record yet is `verdict: null`). */
export function verdictOf(agent: AgentRosterEntry, now: Date): Verdict {
  if (agent.appMaster) {
    const b = agent.backbone;
    return { kind: "backbone", verdict: b ? b.verdict : null, mark: b ? BACKBONE_MARK[b.verdict] : "unknown" };
  }
  const v = expectationsVerdict(metricsOf(agent.metrics), agent.aggregates, agent.createdAt, now, agent.kpiDeltas);
  const mark: MarkState = v.total === 0 || !v.hasData ? "unknown" : v.met === v.total ? "pass" : v.met === 0 ? "fail" : "unknown";
  return { kind: "metrics", mark, v };
}

// ---- why a metric reads "no data" ---------------------------------------------

export type NoDataReason = "never_heard" | "none_accepted" | "uncosted" | "no_runs" | "no_reading";

/** The honest reason a metric has no reading, never a zero: nothing heard, nothing accepted, nothing costed yet
 *  (the provider reports $0 on subscription auth, which is not a measured zero), no runs, or no mapping. */
export function noDataReason(agent: AgentRosterEntry, metricKey: string): NoDataReason {
  const g = agent.aggregates;
  const k = metricKey.toLowerCase();
  if (g.lastActivityAt == null) return agent.lastReportAt ? "none_accepted" : "never_heard";
  if ((k.includes("cost") || k.includes("budget") || k.includes("spend")) && !(g.costUsd > 0)) return "uncosted";
  if (k.includes("success") && g.successRate == null) return "no_runs";
  return "no_reading";
}

/** The lifecycle events the ledger names in words; the roster's `lastDecision.event` is the ledger row's status stem. */
export const KNOWN_EVENTS = ["approved", "onboarding", "activated", "rejected", "retired", "probation_review"] as const;
export type KnownEvent = (typeof KNOWN_EVENTS)[number];

export type ParsedEvent =
  | { kind: "known"; event: KnownEvent }
  /** `poll:<status>`: the pull fallback moved the hire to <status>. */
  | { kind: "poll"; status: string }
  | { kind: "other"; event: string };

export function parseEvent(event: string | undefined): ParsedEvent | null {
  if (!event) return null;
  const [head, ...rest] = event.split(":");
  if (head === "poll" && rest.length > 0) return { kind: "poll", status: rest.join(":") };
  if ((KNOWN_EVENTS as readonly string[]).includes(head)) return { kind: "known", event: head as KnownEvent };
  return { kind: "other", event };
}
