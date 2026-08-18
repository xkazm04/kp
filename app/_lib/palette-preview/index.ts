// Palette preview — the dispatcher. One entry per previewable tab + the entity
// branch; the route (app/api/palette/preview) is a thin shell over this so the
// resolution stays unit-testable without HTTP. Operator-only tabs are decided by
// the CALLER (the route knows the session); this module just takes the flag.
import { attentionCounts } from "@/app/_lib/attention";
import { resolveEntity } from "./resolve-entities";
import { resolveAgents, resolveChannels, resolveDecisions, resolvePipeline, resolveSchedule } from "./resolve-hiring";
import {
  resolveActivity,
  resolveAnalytics,
  resolveBilling,
  resolveBranding,
  resolveHiring,
  resolveIntegrations,
  resolveMatrix,
  resolveModels,
  resolveOrganization,
  resolveWorkspace,
} from "./resolve-insights-settings";
import {
  resolveAnalyze,
  resolveArchetypes,
  resolveAssignments,
  resolveInterview,
  resolveJobs,
  resolveLibrary,
} from "./resolve-library-tools";
import { OPERATOR_ONLY_TABS, type EntityKind, type PalettePreview, type PreviewableTab } from "./types";

export * from "./types";

export async function resolveTabPreview(tab: PreviewableTab, ws: string, operator: boolean): Promise<PalettePreview> {
  if (OPERATOR_ONLY_TABS.has(tab) && !operator) return { view: "restricted" };
  // Lazily computed: only the hiring/library tabs need the badge counts.
  let attention: ReturnType<typeof attentionCounts> | null = null;
  const att = () => (attention ??= attentionCounts(ws));
  switch (tab) {
    case "pipeline":
      return resolvePipeline(ws, att());
    case "channels":
      return resolveChannels(ws, att());
    case "decisions":
      return resolveDecisions(ws, att());
    case "schedule":
      return resolveSchedule(ws);
    case "agents":
      return resolveAgents(ws);
    case "jobs":
      return resolveJobs(ws, att());
    case "library":
      return resolveLibrary(ws);
    case "archetypes":
      return resolveArchetypes(ws);
    case "analyze":
      return resolveAnalyze(ws);
    case "interview":
      return resolveInterview(ws);
    case "assignments":
      return resolveAssignments(ws);
    case "analytics":
      return resolveAnalytics(ws);
    case "matrix":
      return resolveMatrix(ws);
    case "activity":
      return resolveActivity();
    case "about":
      return { view: "about" };
    case "organization":
      return resolveOrganization(ws);
    case "branding":
      return resolveBranding();
    case "billing":
      return resolveBilling(ws);
    case "models":
      return resolveModels();
    case "integrations":
      return resolveIntegrations(ws);
    case "workspace":
      return resolveWorkspace(ws);
    case "hiring":
      return resolveHiring(ws);
  }
}

export function resolveEntityPreview(kind: EntityKind, id: string, ws: string): PalettePreview {
  return resolveEntity(kind, id, ws);
}
