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
import { countOpenProposals } from "./db/companion";
import { countFutureConfirmedInvites } from "./schedule-store";
import { listJobStatuses } from "./job-ingest";
import { needsHumanDecision } from "./approval-kinds";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { getPipelineAxis } from "./pipeline-axis-server";
import { stageHasRole, type StageDef } from "./pipeline-stages";
import { agingTierAt } from "./aging-policy";

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
  // Proposals the companion made that the operator has not answered (WP3).
  //
  // The ONLY key here with no `badgeKey` on any tab, deliberately: Candi lives in
  // a dock, not a tab, so there is no nav item that could carry it. It is read by
  // the dock's own state line, where Accept and Decline are one scroll away. It is
  // also deliberately NOT folded into `decisions` — that count beacons the
  // ControlDock orb and its one click routes to the Decisions tab, which has no
  // affordance that can resolve a companion proposal. A number whose only
  // affordance clears nothing is the failure approval-kinds.ts warns about.
  companion: number;
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
  // The two stage questions below are about MEANING — "have they finished?" and
  // "have they only just arrived?" — so they resolve through this workspace's own
  // axis roles. Reading the literals "Hired" and "Accepted" made both badges
  // silently wrong for a team that renamed its columns: a finished candidate
  // would be counted as aging forever, and the Channels badge would read zero.
  const axis = getPipelineAxis(workspaceId).stages;
  const decisions = entries.filter((e) => e.status === "active" && needsHumanDecision(e.approvalKind)).length;
  const now = Date.now();
  const stale = entries.filter((e) => attentionStale(e, axis, now)).length;
  const schedule = countFutureConfirmedInvites(workspaceId);
  const jobs = Object.values(listJobStatuses(workspaceId)).filter((s) => s === "draft").length;
  const channels = entries.filter((e) => e.status === "active" && stageHasRole(e.stage, "entry", axis)).length;
  const companion = countOpenProposals(workspaceId);
  return { decisions, pipeline: stale, schedule, jobs, channels, companion };
}

/** The badge's "past its stage SLA" predicate — ONE aging clock (aging-policy.ts), the
 *  same tier the board's amber dot and the automation pass's feed alerts read, resolved
 *  on this workspace's own axis. Server-side it deliberately uses the role DEFAULTS: a
 *  recruiter's per-board localStorage overrides are a client concern the badge
 *  approximates.
 *
 *  What the tier encodes (and what this predicate used to hand-roll): a terminal-ROLE
 *  stage never ages, and a NON-POSITIVE SLA never ages either — so a workspace that
 *  renamed its terminal column and RETIRED the id "Hired" does not count every
 *  already-hired entry (stage 'Hired', status 'active', see pipeline-status.ts) as
 *  aging from day 0 forever. A composed column ("Tech round", role interview) ages at
 *  its role's SLA, not on the flat legacy cut a name lookup fell through to. */
export function attentionStale(
  e: Pick<Entry, "status" | "stage" | "stageChangedAt">,
  axis: readonly StageDef[],
  now: number
): boolean {
  if (e.status !== "active") return false;
  return agingTierAt(e.stage, e.stageChangedAt, now, axis) !== "none";
}
