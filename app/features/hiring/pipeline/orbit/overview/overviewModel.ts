/*
 * The Overview's pure half ("The Orbit, Lit", the /contest orbit-overview winner B/1, 2026-09-30):
 * which queues it shows and in which column, who is "first up", what the waiting count is made of,
 * and the totals under the orbit (the wires from a queue to its ring are the kit's geometry,
 * app/_components/kit/scene/wireGeometry.ts). Everything is derived from the board payload and the orbit
 * model the page already holds; nothing is simulated.
 */
import type { Entry, StageDef } from "@/app/features/shared/pipelineTypes";
import type { WorkspaceTabId } from "@/app/features/shell/tabs";
import { DECISIONS_QUEUE_KINDS } from "../../../decisions/decisionsQueueTypes.ts";
import type { RailBucket, RailBucketKey } from "../../pipelineBoardPopulation";
import type { OrbitModel, OrbitPerson } from "../orbitModel";

const DAY_MS = 86_400_000;

/* ---------------------------------------------------------------- queues */

/** Today's rail rows, plus the decisions queue the rail never had. */
export type QueueKey = RailBucketKey | "decisions";

export type OverviewQueue = {
  key: QueueKey;
  entries: Entry[];
  /** The stage this queue stands on (the orbit opens with that ring focused), else null. */
  stage: string | null;
  /** The tab it is worked on when it is not a stage here (Decisions, Schedule), else null. */
  tab: WorkspaceTabId | null;
  /** Waiting on YOU (a decision, a review, an approval): the "needs you" column. */
  needs: boolean;
};

/*
 * WHICH POPULATION EACH NUMBER COUNTS (the Overview shows three "waiting" numbers; they must never be
 * read as one):
 *  - The head numeral (OverviewHead, `model.total.wait`): every person the orbit DRAWS (the board's
 *    active, non-simulated population, on a stage of this workspace's axis) whose approval kind is any
 *    of the six in APPROVAL_KINDS (`needsHumanDecision`), broken down BY KIND in words ("17 screening
 *    reviews, 6 interview slots, 5 key decisions and 1 scorecard").
 *  - The decisions queue card (below, `key: "decisions"`): the same drawn population, only the kinds
 *    the Decisions tab decides (DECISIONS_QUEUE_KINDS) that no other card already names, so it is
 *    "N waiting on a decision or review" (key decisions + screening and rejection reviews), a SUBSET
 *    of the head. The scorecard and drafted-offer cards are the rest of the Decisions tab's queue;
 *    `calendar` is Schedule's "interviews waiting on a slot".
 *  - The Decisions nav badge (app/_lib/attention.ts `attentionCounts().decisions`) keeps its own,
 *    server-side rule: every ACTIVE entry of the workspace with any recognized approval kind, off-axis
 *    stages and simulation rows included. It agrees with the head on a board with no simulated or
 *    off-axis rows; it is the sidebar's count, not this page's.
 */

/** Kinds that have a rail row of their own, so the decisions queue leaves them to it. */
const OWN_ROW_KINDS: ReadonlySet<string> = new Set(["scorecard_review", "offer_review"]);
/** The kinds the decisions queue counts: the Decisions tab's own set, minus the kinds with their own card. */
const DECISION_KINDS: ReadonlySet<string> = new Set(DECISIONS_QUEUE_KINDS.filter((k) => !OWN_ROW_KINDS.has(k)));
const NEEDS: ReadonlySet<QueueKey> = new Set<QueueKey>(["decisions", "scorecards", "offerReviews"]);

/**
 * The Overview's queues, in reading order: the decisions queue first (the largest human gate), then
 * the rail's rows as `deriveRailRows` ordered them. `active` is the board's live population
 * (`boardPopulation(...).active`), the same one the rail buckets; the decisions queue keeps only the
 * people on a stage of `axis` (the ones the orbit draws and the head counts).
 */
export function overviewQueues(rows: readonly RailBucket[], active: readonly Entry[], axis: readonly Pick<StageDef, "id">[]): OverviewQueue[] {
  const onAxis = new Set(axis.map((s) => s.id));
  const decided = active.filter((e) => e.approvalKind != null && DECISION_KINDS.has(e.approvalKind) && onAxis.has(e.stage));
  const all: Omit<OverviewQueue, "needs">[] = [
    ...(decided.length ? [{ key: "decisions" as const, entries: decided, stage: null, tab: "decisions" as const }] : []),
    ...rows.map((r) => ({ key: r.key, entries: r.entries, stage: r.stage ?? null, tab: r.tab ?? null })),
  ];
  return all.map((q) => ({ ...q, needs: NEEDS.has(q.key) }));
}

/** When an entry last moved (else when it was added), as epoch ms; NaN when neither parses. */
const movedAt = (e: Entry) => Date.parse(e.stageChangedAt ?? e.createdAt ?? "");

/** Who to name first on a card: waiting on a human, then over the SLA, then longest on the stage. */
export function urgentFirst(entries: readonly Entry[], model: Pick<OrbitModel, "byId">): Entry[] {
  const rank = (e: Entry) => {
    const p = model.byId.get(e.id);
    return p?.waiting ? 0 : p?.aging ? 1 : 2;
  };
  const at = (e: Entry) => { const t = movedAt(e); return Number.isFinite(t) ? t : Infinity; };
  return [...entries].sort((a, b) => rank(a) - rank(b) || at(a) - at(b) || a.candidateLabel.localeCompare(b.candidateLabel));
}

/**
 * The ring a queue's wire goes to: the stage most of its drawn people stand on (ties: the outer
 * ring). A queue whose people are not drawn (this week's hires who already left the live funnel)
 * falls back to the stage it names, else null.
 */
export function mainStage(entries: readonly Entry[], model: Pick<OrbitModel, "byId">, fallback: number | null = null): number | null {
  const count = new Map<number, number>();
  for (const e of entries) {
    const si = model.byId.get(e.id)?.si;
    if (si != null) count.set(si, (count.get(si) ?? 0) + 1);
  }
  let best: number | null = null;
  for (const [si, n] of count) {
    const b = best == null ? 0 : count.get(best) ?? 0;
    if (best == null || n > b || (n === b && si < best)) best = si;
  }
  return best ?? fallback;
}

/* ---------------------------------------------------------------- what is lit */

/** How a lit set was asked for: the pointer over a card, or keyboard focus inside it. */
export type LitVia = "pointer" | "focus";
/** Two slots, one per way of asking: the pointer wins while it points; leaving falls back to focus. */
export type LitSlots<T extends { key: string }> = { readonly pointer: T | null; readonly focus: T | null };
export const NO_LIT: LitSlots<never> = { pointer: null, focus: null };

/**
 * One lighting event: `on` fills the slot `via` with `set`; `off` empties it only while `set` still
 * holds it (a late "leave" from a card that lost the slot changes nothing). With keyboard focus in
 * card B, pointing at card A lights A, and leaving A lights B again, never nobody.
 */
export function litStep<T extends { key: string }>(s: LitSlots<T>, via: LitVia, set: T, on: boolean): LitSlots<T> {
  if (on) return via === "pointer" ? { ...s, pointer: set } : { ...s, focus: set };
  if (s[via]?.key !== set.key) return s;
  return via === "pointer" ? { ...s, pointer: null } : { ...s, focus: null };
}

/** The set that is lit now. */
export function litNow<T extends { key: string }>(s: LitSlots<T>): T | null {
  return s.pointer ?? s.focus;
}

/* ---------------------------------------------------------------- the head */

export type WaitPart = { kind: string; count: number };

/** What the waiting-on-a-human count is made of, by approval kind: most first, then `order`. */
export function waitBreakdown(people: readonly Pick<OrbitPerson, "waiting">[], order: readonly string[]): WaitPart[] {
  const by = new Map<string, number>();
  for (const p of people) if (p.waiting) by.set(p.waiting, (by.get(p.waiting) ?? 0) + 1);
  const pos = (k: string) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
  return [...by].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || pos(a.kind) - pos(b.kind));
}

/* ---------------------------------------------------------------- first up */

export type FirstUp =
  | { state: "none" }
  /** People are waiting, but none of them has a running stage clock (placed and never moved, or on a
   *  stage with no cadence, such as the terminal one). */
  | { state: "noClock"; waiting: number }
  | { state: "ok"; person: OrbitPerson; days: number; sla: number; over: boolean };

/**
 * The one person to start with: of the people waiting on a human who HAVE a clock (they moved onto
 * their stage, which is not the terminal one, and the stage has a cadence), the one furthest over
 * their stage's SLA; when nobody is over, the one nearest it. `sla` is each column's cadence in days
 * (axis order, 0 = no clock). Aging is the product's one clock (`over` is the model's `aging`).
 */
export function firstUp(people: readonly OrbitPerson[], sla: readonly number[], now: number): FirstUp {
  const waiting = people.filter((p) => p.waiting);
  if (!waiting.length) return { state: "none" };
  let best: { p: OrbitPerson; days: number; sla: number; rel: number } | null = null;
  for (const p of waiting) {
    const cadence = sla[p.si] ?? 0;
    if (!p.walked || p.terminal || cadence <= 0) continue;
    const t = Date.parse(p.entry.stageChangedAt ?? "");
    if (!Number.isFinite(t)) continue;
    const days = Math.max(0, Math.floor((now - t) / DAY_MS));
    const rel = days - cadence;
    if (!best || rel > best.rel || (rel === best.rel && (days > best.days || (days === best.days && p.name.localeCompare(best.p.name) < 0)))) {
      best = { p, days, sla: cadence, rel };
    }
  }
  if (!best) return { state: "noClock", waiting: waiting.length };
  return { state: "ok", person: best.p, days: best.days, sla: best.sla, over: best.p.aging };
}

/* ---------------------------------------------------------------- totals */

/**
 * The SLA line under the orbit: of the people the clock MEASURES (moved onto a non-terminal stage;
 * a placed-never-moved person has no day count and is not measured), how many are inside their
 * stage's SLA and how many are over it.
 */
export function slaTotals(people: readonly Pick<OrbitPerson, "walked" | "terminal" | "aging">[]): { measured: number; inside: number; over: number } {
  let measured = 0;
  let over = 0;
  for (const p of people) {
    if (!p.walked || p.terminal) continue;
    measured++;
    if (p.aging) over++;
  }
  return { measured, inside: measured - over, over };
}
