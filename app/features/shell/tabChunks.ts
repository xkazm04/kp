"use client";

// The ONE import map for every code-split tab chunk, and the prefetch door into it.
//
// Split out of WorkspaceTabChunks.tsx so the loaders have a second consumer: the
// component registry (next/dynamic) renders a chunk, this module can also just
// *start* it. A tab click used to be the first moment its chunk was requested, so
// the download sat on the critical path between the click and the first frame —
// the <Defer>/skeleton choreography can hide a slow render, but not a network
// fetch that hasn't begun. Warming the module on hover/focus (and, for the tabs a
// session almost always visits, on idle after mount) moves that fetch off the
// interaction entirely.
//
// A loader is just `() => import(...)`: the bundler memoizes the module promise by
// specifier, so calling it here and letting next/dynamic call it again later is
// one download, not two. Keep these specifiers BYTE-IDENTICAL to the ones in
// WorkspaceTabChunks.tsx — a differing string is a different module record and the
// prefetch would warm a chunk the render never awaits.

import type { WorkspaceTabId } from "./tabs";

export const TAB_CHUNKS = {
  about: () => import("../insights/about/AboutTab"),
  analyze: () => import("../tools/analyze/AnalyzeWorkspace"),
  decisions: () => import("../hiring/decisions/DecisionsTab"),
  schedule: () => import("../hiring/schedule/ScheduleTab"),
  jobs: () => import("../library/jobs/JobsTab"),
  library: () => import("../library/jds/JdsTab"),
  matrix: () => import("../insights/matrix/MatrixTab"),
  analytics: () => import("../insights/analytics/AnalyticsTab"),
  activity: () => import("../insights/activity/ActivityTab"),
  pipeline: () => import("../hiring/pipeline/PipelineTab"),
  agents: () => import("../agents-workforce/AgentsWorkforceTab"),
  channels: () => import("../hiring/channels/ChannelsTab"),
  assignments: () => import("../tools/devcases/DevTab"),
  archetypes: () => import("../tools/profile/ProfileTab"),
  interview: () => import("../tools/interview/InterviewSimTab"),
  tasks: () => import("./tasks/TasksTab"),
  billing: () => import("../settings/billing/BillingTab"),
  models: () => import("../settings/models/ModelsTab"),
  workspace: () => import("../settings/workspace/WorkspaceTab"),
  organization: () => import("../settings/organization/OrganizationTab"),
  integrations: () => import("../settings/integrations/IntegrationsTab"),
  branding: () => import("../settings/branding/BrandingTab"),
  hiring: () => import("../settings/hiring/HiringTab"),
} as const;

/** Tab ids that own a chunk. `history` has none — it is Analyze in another mode. */
export type ChunkedTabId = keyof typeof TAB_CHUNKS;

/** History is consolidated into Analyze (see Workspace's navActive), so it warms
 *  the Analyze chunk rather than having none. */
function chunkIdFor(id: WorkspaceTabId): ChunkedTabId | null {
  if (id === "history") return "analyze";
  return id in TAB_CHUNKS ? (id as ChunkedTabId) : null;
}

// Fire-and-forget bookkeeping: one attempt per tab per document. A rejected
// prefetch is deliberately swallowed — the render path will request the chunk
// again and surface a real failure through the tab's ErrorBoundary; a prefetch
// must never be the thing that breaks a page.
const requested = new Set<ChunkedTabId>();

/** Start a tab's chunk download now. Safe to call on every hover — idempotent. */
export function prefetchTabChunk(id: WorkspaceTabId): void {
  const chunk = chunkIdFor(id);
  if (!chunk || requested.has(chunk)) return;
  requested.add(chunk);
  void TAB_CHUNKS[chunk]().catch(() => {
    requested.delete(chunk);
  });
}

/** The tabs worth warming unprompted: the hiring flow the sidebar opens on, minus
 *  whichever one is already rendering. Everything else waits for a hover. */
const IDLE_WARM: readonly WorkspaceTabId[] = ["pipeline", "channels", "decisions", "schedule"];

/**
 * Warm the likely-next tabs once the browser is idle. Called from the shell after
 * mount; the idle callback means this never competes with hydration or the active
 * tab's own first paint, and the 2s timeout keeps a permanently busy main thread
 * from starving it forever.
 */
export function warmLikelyTabChunks(activeTab: WorkspaceTabId): () => void {
  const run = () => {
    for (const id of IDLE_WARM) {
      if (id !== activeTab) prefetchTabChunk(id);
    }
  };
  if (typeof window === "undefined") return () => undefined;
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(run, { timeout: 2000 });
    return () => window.cancelIdleCallback?.(handle);
  }
  // Safari / jsdom: a macrotask is the closest always-fires equivalent.
  const timer = window.setTimeout(run, 500);
  return () => window.clearTimeout(timer);
}
