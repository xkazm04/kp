// Palette preview resolvers — the HIRING section (Overview, Channels, Decisions,
// Schedule, Agents). Cheap synchronous reads only; each returns one union member
// from ./types. `attention` is the same AttentionCounts the sidebar badges show,
// computed once by the dispatcher and shared.
import type { AttentionCounts } from "@/app/_lib/attention";
import { getWorkspaceAgentTotals } from "@/app/_lib/db/agents";
import { listChannelWebhooks } from "@/app/_lib/db/channels";
import { countPipelineByStage, listJobPipelineStats } from "@/app/_lib/db/pipeline";
import { isRelayConfigured } from "@/app/_lib/comms-relay";
import { getCalendarConnection } from "@/app/_lib/calendar/token-store";
import { listDecisionRecords, verifyDecisionChain } from "@/app/_lib/decision-record-store";
import { getPipelineAxis } from "@/app/_lib/pipeline-axis-server";
import { countFutureConfirmedInvites, listScheduleInvites } from "@/app/_lib/schedule-store";
import type { PalettePreview } from "./types";

export function resolvePipeline(ws: string, attention: AttentionCounts): PalettePreview {
  const byStage = countPipelineByStage(ws);
  const axis = getPipelineAxis(ws);
  const stages = axis.stages.map((s) => ({ id: s.id, label: s.label, count: byStage[s.id] ?? 0 }));
  const active = Object.values(byStage).reduce((a, b) => a + b, 0);
  const hired = Object.values(listJobPipelineStats(ws)).reduce((a, s) => a + s.hired, 0);
  return { view: "pipeline", active, aging: attention.pipeline, stages, hired };
}

export function resolveChannels(ws: string, attention: AttentionCounts): PalettePreview {
  const hooks = listChannelWebhooks(ws);
  let accepted = 0;
  let last: string | null = null;
  for (const h of hooks) {
    accepted += h.acceptedCount;
    if (h.lastReceivedAt && (!last || h.lastReceivedAt > last)) last = h.lastReceivedAt;
  }
  return {
    view: "channels",
    receivers: hooks.length,
    accepted,
    fresh: attention.channels,
    lastReceivedAt: last,
    relayConfigured: isRelayConfigured(),
  };
}

/** Widest page the degraded fallback below may read (listDecisionRecords' own clamp). */
const DECISION_PAGE_MAX = 1000;

export function resolveDecisions(ws: string, attention: AttentionCounts): PalettePreview {
  let chain: { ok: boolean; count: number } | null = null;
  try {
    const v = verifyDecisionChain(ws);
    chain = { ok: v.ok, count: v.count };
  } catch {
    chain = null; // integrity check unavailable ≠ broken — the pane says nothing
  }
  // `sealed` is the workspace's TOTAL sealed decisions, so it comes from the chain
  // CENSUS — verifyDecisionChain walks every row of this tenant's chain in seq order
  // and reports `count` on every verdict, ok or broken. It used to be
  // `listDecisionRecords({ limit: 500 }).length`, i.e. the size of a capped PAGE: past
  // 500 records the "Sealed" tile froze at 500 while the chain line directly beneath it
  // (same pane, same read) went on reporting the true 612 — one surface contradicting
  // itself, with the tile the provably wrong half. Reusing the census also drops a
  // second full-table read of the same rows.
  const sealed = chain ? chain.count : listDecisionRecords({ limit: DECISION_PAGE_MAX, workspaceId: ws }).length;
  return { view: "decisions", pending: attention.decisions, sealed, chain };
}

export function resolveSchedule(ws: string): PalettePreview {
  const now = Date.now();
  const invites = listScheduleInvites(200, ws);
  let awaiting = 0;
  let needsMoreSlots = 0;
  let next: { at: string; candidate: string | null; jobTitle: string | null } | null = null;
  for (const inv of invites) {
    if (inv.status === "pending") awaiting += 1;
    if (inv.needsMoreSlots) needsMoreSlots += 1;
    if (inv.status === "confirmed" && inv.slotAt && Date.parse(inv.slotAt) > now && (!next || inv.slotAt < next.at)) {
      next = { at: inv.slotAt, candidate: inv.candidateLabel, jobTitle: inv.jobTitle };
    }
  }
  return {
    view: "schedule",
    confirmed: countFutureConfirmedInvites(ws, now),
    awaiting,
    needsMoreSlots,
    calendarConnected: getCalendarConnection(ws)?.connected === true,
    next,
  };
}

export function resolveAgents(ws: string): PalettePreview {
  // ONE activity read for the workspace, not one per hired agent. This used to list
  // the agents and call getAgentAggregates in a loop — N+1 queries on a pane that
  // opens on a keystroke, growing with headcount. getWorkspaceAgentTotals runs the
  // same per-agent precedence rule (a month's rollup beats that month's executions)
  // over a single grouped read, so the numbers are identical and the cost is not.
  const totals = getWorkspaceAgentTotals(ws);
  return {
    view: "agents",
    agents: totals.agents,
    runs: totals.runs,
    successRate: totals.successRate,
    monthCostUsd: totals.monthCostUsd,
  };
}
