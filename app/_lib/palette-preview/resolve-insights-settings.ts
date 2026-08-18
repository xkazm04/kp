// Palette preview resolvers — INSIGHTS (Analytics, Matrix, Activity, About) and
// SETTINGS (Organization, Branding, Billing, Models, Integrations, Workspaces,
// Hiring). Settings views read operator state (plan meters, key inventory,
// connection rows) — the dispatcher gates them behind isOperator() and hands
// demo sessions a "restricted" view instead of calling these.
import { getAtsConfig } from "@/app/_lib/ats-config-store";
import { listAtsConnections } from "@/app/_lib/ats/connections-store";
import { billingOrgForWorkspace, billingOverview, polarGatewayFromEnv } from "@/app/_lib/billing";
import { getBrand } from "@/app/_lib/brand-store";
import { getCalendarConnection } from "@/app/_lib/calendar/token-store";
import { isRelayConfigured } from "@/app/_lib/comms-relay";
import { listInvitesForOrg } from "@/app/_lib/db/invites";
import { aggregateLlmUsage, listLlmConfig } from "@/app/_lib/db/llm";
import { listMembershipsForWorkspace } from "@/app/_lib/db/memberships";
import { getOrganization } from "@/app/_lib/db/organizations";
import { countPipelineByStage, listJobPipelineStats } from "@/app/_lib/db/pipeline";
import { countMatrixProfiles, listOpenPositions, pipelinePlacements } from "@/app/_lib/db/profiles";
import { countActiveTasks } from "@/app/_lib/db/tasks";
import { getWorkspace, listWorkspacesByOrg } from "@/app/_lib/db/workspaces";
import { getActiveRegimeId } from "@/app/_lib/decision-config-store";
import { LLM_USE_CASES, listProviderKeyMeta } from "@/app/_lib/llm-config";
import { listOrgMembers } from "@/app/_lib/org-service";
import { getPipelineAxis } from "@/app/_lib/pipeline-axis-server";
import { multiWorkspaceEnabled } from "@/app/_lib/workspace-lock";
import type { PalettePreview } from "./types";

// ── Insights ──

export function resolveAnalytics(ws: string): PalettePreview {
  let total = 0;
  let reachedInterview = 0;
  let hired = 0;
  for (const s of Object.values(listJobPipelineStats(ws))) {
    total += s.total;
    reachedInterview += s.reachedInterview;
    hired += s.hired;
  }
  return { view: "analytics", total, reachedInterview, hired, conversionPct: total > 0 ? Math.round((hired / total) * 100) : null };
}

export function resolveMatrix(ws: string): PalettePreview {
  return {
    view: "matrix",
    candidates: countMatrixProfiles(ws),
    openPositions: listOpenPositions(ws).length,
    placements: Object.keys(pipelinePlacements(ws)).length,
  };
}

/** Global (not tenant-scoped) by nature: the LLM ledger and the task queue. */
export function resolveActivity(): PalettePreview {
  const rows = aggregateLlmUsage(30);
  const providers = new Set<string>();
  let calls30d = 0;
  let costUsd30d = 0;
  for (const r of rows) {
    calls30d += r.calls;
    costUsd30d += r.costUsd;
    providers.add(r.provider);
  }
  const q = countActiveTasks();
  return { view: "activity", calls30d, costUsd30d, providers: providers.size, running: q.running, queued: q.queued };
}

// ── Settings ──

export function resolveOrganization(ws: string): PalettePreview {
  const orgId = billingOrgForWorkspace(ws);
  const org = getOrganization(orgId);
  const brand = getBrand();
  return {
    view: "organization",
    name: org?.name ?? brand.displayName ?? "—",
    domain: org?.domain ?? null,
    logoUrl: brand.logoUrl,
    members: listOrgMembers(orgId).length,
    pendingInvites: listInvitesForOrg(orgId, "pending").length,
    workspaces: listWorkspacesByOrg(orgId).length,
  };
}

export function resolveBranding(): PalettePreview {
  const b = getBrand();
  return { view: "branding", displayName: b.displayName, accentColor: b.accentColor, logoUrl: b.logoUrl };
}

export function resolveBilling(ws: string): PalettePreview {
  const o = billingOverview(new Date(), ws);
  return {
    view: "billing",
    plan: o.plan.name,
    status: o.status,
    periodEnd: o.periodEnd,
    configured: polarGatewayFromEnv() !== null,
    meters: o.meters.map((m) => ({ meter: m.meter, used: m.used, limit: m.limit })),
  };
}

export function resolveModels(): PalettePreview {
  const routed = listLlmConfig().length;
  const providers = [...new Set(listProviderKeyMeta().map((k) => k.provider))].sort();
  const costUsd30d = aggregateLlmUsage(30).reduce((a, r) => a + r.costUsd, 0);
  return { view: "models", routed, useCases: LLM_USE_CASES.length, providers, costUsd30d };
}

export function resolveIntegrations(ws: string): PalettePreview {
  const cal = getCalendarConnection(ws);
  const ats = getAtsConfig();
  const conns = listAtsConnections();
  const enabledConns = conns.filter((c) => c.enabled && c.hasToken);
  return {
    view: "integrations",
    items: [
      { id: "calendar", state: cal?.connected ? "connected" : "missing", detail: cal?.accountEmail ?? null },
      { id: "relay", state: isRelayConfigured() ? "configured" : "missing", detail: null },
      { id: "atsWebhook", state: ats.webhookUrl ? "configured" : "missing", detail: ats.webhookUrl ? `${ats.events.length}` : null },
      {
        id: "atsConnections",
        state: enabledConns.length > 0 ? "connected" : "missing",
        detail: enabledConns.length > 0 ? enabledConns.map((c) => c.provider).join(", ") : null,
      },
    ],
  };
}

export function resolveWorkspace(ws: string): PalettePreview {
  const orgId = billingOrgForWorkspace(ws);
  const current = getWorkspace(ws);
  return {
    view: "workspace",
    count: listWorkspacesByOrg(orgId).length,
    current: current?.name ?? ws,
    members: listMembershipsForWorkspace(ws).length,
    multi: multiWorkspaceEnabled(),
  };
}

export function resolveHiring(ws: string): PalettePreview {
  const axis = getPipelineAxis(ws);
  const active = Object.values(countPipelineByStage(ws)).reduce((a, b) => a + b, 0);
  let regime: string | null = null;
  try {
    regime = getActiveRegimeId(ws);
  } catch {
    regime = null;
  }
  return { view: "hiring", stages: axis.stages.map((s) => s.label), regime, active };
}
