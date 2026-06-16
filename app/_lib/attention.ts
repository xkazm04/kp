// SHELL2 — the "what needs my attention" counts behind the sidebar nav badges.
// Each count was already derivable, but only INSIDE its own tab (Decisions
// derived pending approvals from /api/pipeline, the board derived SLA staleness,
// Schedule knew its due reminders) — so a recruiter sitting on Jobs had zero
// awareness that six decisions were queued. One server-side module computes them
// all; the /api/attention route serves the interactive shell and WorkspaceNav
// (a server component) calls it directly for the deep-link pages.
//
// Keys deliberately match tabs.ts `badgeKey` values — the mapping from count to
// nav item is declarative, not positional.

import { listPipeline } from "./db";
import { dueReminders } from "./schedule-store";
import { listJobStatuses } from "./job-ingest";
import { needsHumanDecision } from "./approval-kinds";
import { daysSince, slaForStage } from "@/app/features/sub_pipeline/PipelineTypes";

export type AttentionCounts = {
  // Entries waiting on a recognized human approval gate → Decisions.
  decisions: number;
  // Active entries past their stage's default aging SLA → Pipeline. Server-side
  // counts use STAGE_SLA_DEFAULTS — a recruiter's per-board localStorage
  // overrides are a client concern the badge deliberately approximates.
  pipeline: number;
  // Schedule invites inside the reminder window → Schedule.
  schedule: number;
  // Ingested roles still sitting unpublished as drafts → Jobs.
  jobs: number;
  // Fresh inbound: active entries still at the "Accepted" entry stage →
  // Channels. Same cohort ChannelsTab counts as "received in Accepted", so the
  // nav signals new arrivals without the recruiter camping on the tab.
  channels: number;
};

export function attentionCounts(): AttentionCounts {
  // listPipeline already excludes terminal (rejected/declined) entries.
  const entries = listPipeline();
  const decisions = entries.filter((e) => e.status === "active" && needsHumanDecision(e.approvalKind)).length;
  const stale = entries.filter(
    (e) => e.status === "active" && e.stage !== "Hired" && (daysSince(e.stageChangedAt) ?? 0) >= slaForStage(e.stage)
  ).length;
  const schedule = dueReminders().length;
  const jobs = Object.values(listJobStatuses()).filter((s) => s === "draft").length;
  const channels = entries.filter((e) => e.status === "active" && e.stage === "Accepted").length;
  return { decisions, pipeline: stale, schedule, jobs, channels };
}
