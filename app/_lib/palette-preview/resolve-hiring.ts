// Palette preview resolvers — the HIRING section (Overview, Channels, Decisions,
// Schedule, Agents). Cheap synchronous reads only; each returns one union member
// from ./types. `attention` is the same AttentionCounts the sidebar badges show,
// computed once by the dispatcher and shared.
import type { AttentionCounts } from "@/app/_lib/attention";
import { getAgentAggregates, listHiredAgents } from "@/app/_lib/db/agents";
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

export function resolveDecisions(ws: string, attention: AttentionCounts): PalettePreview {
  const sealed = listDecisionRecords({ limit: 500, workspaceId: ws }).length;
  let chain: { ok: boolean; count: number } | null = null;
  try {
    const v = verifyDecisionChain(ws);
    chain = { ok: v.ok, count: v.count };
  } catch {
    chain = null; // integrity check unavailable ≠ broken — the pane says nothing
  }
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
  const agents = listHiredAgents(ws);
  let runs = 0;
  let successes = 0;
  let monthCostUsd = 0;
  for (const a of agents) {
    const agg = getAgentAggregates(a.id, ws);
    runs += agg.runs;
    successes += agg.successes;
    monthCostUsd += agg.monthCostUsd;
  }
  return { view: "agents", agents: agents.length, runs, successRate: runs > 0 ? successes / runs : null, monthCostUsd };
}
