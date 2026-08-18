// The command palette's PREVIEW contract — what the pane on the right of the
// palette shows for a highlighted destination (a workspace tab) or entity (a
// search hit). One discriminated union, JSON-safe, tenant-scoped at resolve time.
//
// Design rule: each view carries the FEW facts a recruiter would want before
// pressing Enter — never a row dump. Server resolvers (./resolve-*.ts) compute
// them from the cheap primitives (counts, small lists), never the heavy
// analytics or a Python spawn; the client (app/features/shell/palette/) draws
// each view with its own small component. Adding a view = one union member +
// one resolver case + one renderer.

export type PalettePreview =
  // ── Hiring ──
  | {
      view: "pipeline";
      active: number;
      aging: number;
      /** Active entries per axis stage, in board order (labels already resolved). */
      stages: { id: string; label: string; count: number }[];
      hired: number;
    }
  | {
      view: "channels";
      receivers: number;
      accepted: number;
      fresh: number;
      lastReceivedAt: string | null;
      relayConfigured: boolean;
    }
  | { view: "decisions"; pending: number; sealed: number; chain: { ok: boolean; count: number } | null }
  | {
      view: "schedule";
      confirmed: number;
      awaiting: number;
      needsMoreSlots: number;
      calendarConnected: boolean;
      next: { at: string; candidate: string | null; jobTitle: string | null } | null;
    }
  | { view: "agents"; agents: number; runs: number; successRate: number | null; monthCostUsd: number }
  // ── Library ──
  | { view: "jobs"; total: number; draft: number; entryEligible: number; families: { name: string; count: number }[] }
  | {
      view: "library";
      total: number;
      analyzing: number;
      failed: number;
      templates: number;
      newest: { title: string; createdAt: string } | null;
    }
  // ── Tools ──
  | { view: "archetypes"; archetypes: number; candidates: number; top: { name: string; count: number }[] }
  | {
      view: "analyze";
      analyses: number;
      avgScore: number | null;
      latest: { label: string; score: number | null; createdAt: string } | null;
    }
  | { view: "interview"; sessions: number; completed: number; live: number; latest: { candidate: string; status: string; createdAt: string } | null }
  | { view: "assignments"; cases: number; postings: number; submissions: number }
  // ── Insights ──
  | { view: "analytics"; total: number; reachedInterview: number; hired: number; conversionPct: number | null }
  | { view: "matrix"; candidates: number; openPositions: number; placements: number }
  | { view: "activity"; calls30d: number; costUsd30d: number; providers: number; running: number; queued: number }
  | { view: "about" }
  // ── Settings ──
  | {
      view: "organization";
      name: string;
      domain: string | null;
      logoUrl: string | null;
      members: number;
      pendingInvites: number;
      workspaces: number;
    }
  | { view: "branding"; displayName: string | null; accentColor: string | null; logoUrl: string | null }
  | {
      view: "billing";
      plan: string;
      status: string;
      periodEnd: string | null;
      configured: boolean;
      meters: { meter: string; used: number; limit: number | null }[];
    }
  | { view: "models"; routed: number; useCases: number; providers: string[]; costUsd30d: number }
  | {
      view: "integrations";
      items: { id: "calendar" | "relay" | "atsWebhook" | "atsConnections"; state: "connected" | "configured" | "missing"; detail: string | null }[];
    }
  | { view: "workspace"; count: number; current: string; members: number; multi: boolean }
  | { view: "hiring"; stages: string[]; regime: string | null; active: number }
  // ── Entities ──
  | {
      view: "profile";
      label: string;
      archetype: string | null;
      roleFamily: string | null;
      completeness: number | null;
      createdAt: string;
      placements: { jobTitle: string; stage: string }[];
    }
  | {
      view: "entry";
      candidate: string;
      jobTitle: string | null;
      stage: string;
      matchScore: number | null;
      stageChangedAt: string | null;
      source: string | null;
      approvalKind: string | null;
      nextInvite: { status: string; slot: string | null } | null;
    }
  | {
      view: "job";
      title: string;
      company: string | null;
      location: string | null;
      seniority: string | null;
      status: string | null;
      total: number;
      reachedInterview: number;
      hired: number;
    }
  | { view: "jd"; title: string; createdAt: string; analysisStatus: string | null; analyses: number; words: number }
  | {
      view: "analysis";
      label: string;
      score: number | null;
      roleFamily: string | null;
      seniority: string | null;
      disposition: string | null;
      createdAt: string;
      jdSlug: string | null;
    }
  // ── Guards ──
  | { view: "restricted" }
  | { view: "missing" };

export type PreviewView = PalettePreview["view"];

/** The tab ids the preview knows how to describe. Anything else → "missing". */
export const PREVIEWABLE_TABS = [
  "pipeline",
  "channels",
  "decisions",
  "schedule",
  "agents",
  "jobs",
  "library",
  "archetypes",
  "analyze",
  "interview",
  "assignments",
  "analytics",
  "matrix",
  "activity",
  "about",
  "organization",
  "branding",
  "billing",
  "models",
  "integrations",
  "workspace",
  "hiring",
] as const;
export type PreviewableTab = (typeof PREVIEWABLE_TABS)[number];
export function isPreviewableTab(v: string): v is PreviewableTab {
  return (PREVIEWABLE_TABS as readonly string[]).includes(v);
}

/** Views that expose operator-only state (billing meters, key inventory,
 *  connection state, org roster) — resolved as "restricted" for demo sessions. */
export const OPERATOR_ONLY_TABS: ReadonlySet<PreviewableTab> = new Set(["billing", "models", "integrations", "organization", "workspace"]);

export const ENTITY_KINDS = ["profile", "entry", "job", "jd", "analysis"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];
export function isEntityKind(v: string): v is EntityKind {
  return (ENTITY_KINDS as readonly string[]).includes(v);
}
