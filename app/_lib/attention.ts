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

// Import the SLICE, not the `./db` barrel. The barrel `export *`s 17 store modules
// (52 first-party modules / ~707 KB of source), and `next dev` compiles a route's
// whole module graph with no tree-shaking — so a barrel import makes every route
// pay for the entire data layer on its first hit. This one line took /api/attention
// from 68 modules to 43. See "Dev compile cost" in docs/architecture/app-structure.md.
import { listPipeline } from "./db/pipeline";
import { countFutureConfirmedInvites } from "./schedule-store";
import { listJobStatuses } from "./job-ingest";
import { needsHumanDecision } from "./approval-kinds";
import { daysSince, slaForStage } from "@/app/features/shared/pipelineTypes";

export type AttentionCounts = {
  // Entries waiting on a recognized human approval gate → Decisions.
  decisions: number;
  // Active entries past their stage's default aging SLA → Pipeline. Server-side
  // counts use STAGE_SLA_DEFAULTS — a recruiter's per-board localStorage
  // overrides are a client concern the badge deliberately approximates.
  pipeline: number;
  // Upcoming calendar events: confirmed interviews whose slot lies in the
  // future → Schedule. (Was the due-reminder count; repointed 2026-08-10 so the
  // badge answers "how many interviews are on the calendar ahead of me".)
  schedule: number;
  // Ingested roles still sitting unpublished as drafts → Jobs.
  jobs: number;
  // Fresh inbound: active entries still at the "Accepted" entry stage →
  // Channels. Same cohort ChannelsTab counts as "received in Accepted", so the
  // nav signals new arrivals without the recruiter camping on the tab.
  channels: number;
};

/** The badge counts for ONE tenant. Every read below is workspace-scoped; the
 *  parameter exists because this module is the ONLY place that decides which
 *  workspace the sidebar is describing.
 *
 *  It used to take none, so all three reads fell through to their
 *  DEFAULT_WORKSPACE_ID default and a recruiter signed into any other team saw
 *  the default team's counts on every badge — the last workspace-blind read path
 *  in the recruiter shell (docs/features/organization/README.md, Known gaps).
 *  Callers pass `await currentWorkspace()`; the default is kept so background
 *  callers and tests behave as before. */
export function attentionCounts(workspaceId?: string): AttentionCounts {
  // listPipeline already excludes terminal (rejected/declined) entries.
  const entries = listPipeline(workspaceId);
  const decisions = entries.filter((e) => e.status === "active" && needsHumanDecision(e.approvalKind)).length;
  const stale = entries.filter(
    (e) => e.status === "active" && e.stage !== "Hired" && (daysSince(e.stageChangedAt) ?? 0) >= slaForStage(e.stage)
  ).length;
  const schedule = countFutureConfirmedInvites(workspaceId);
  const jobs = Object.values(listJobStatuses(workspaceId)).filter((s) => s === "draft").length;
  const channels = entries.filter((e) => e.status === "active" && e.stage === "Accepted").length;
  return { decisions, pipeline: stale, schedule, jobs, channels };
}
