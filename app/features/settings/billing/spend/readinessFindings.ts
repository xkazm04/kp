// Readiness findings -> System strip rows (challenge r03 platform-auth-api/B).
//
// /api/ops sends coded `findings` beside its legacy `degradedReasons`
// (app/_lib/readiness.ts). This pure module decides how each one renders: faults
// before warns, the catalog key its title and fix resolve under
// (models.system.findings.<CODE>), and the action - a door into the tab that repairs it,
// the env vars to set, or none (a host fix, or a wait, which the fix text says in words).
//
// "Does this client know the code" is asked of the CATALOG (`knows`, t.has in the
// component), not of the server's code list: catalogs ship with the client bundle, so a
// server newer than the bundle is exactly the case where a code has no copy here. Such a
// finding renders its English `reason`, and a reason no finding covers (a server older
// than the findings field) renders as it always did. Never a blank row, never a raw key.
//
// Type-only import from the server module: its value half reads the DB.
import type { ReadinessCode, ReadinessFinding, ReadinessSeverity } from "@/app/_lib/readiness";
import { isWorkspaceTabId, type WorkspaceTabId } from "@/app/features/shell/tabs";

export type FindingAction = { type: "tab"; tab: WorkspaceTabId } | { type: "env"; vars: string[] } | { type: "none" };

export type FindingView = {
  /** Stable React key. */
  key: string;
  code: string | null;
  severity: ReadinessSeverity;
  /** `findings.<CODE>` relative to models.system; null when the row is a fallback. */
  catalogKey: `findings.${ReadinessCode}` | null;
  /** ICU params for the title/fix copy. */
  params: Record<string, string>;
  /** The English sentence rendered when there is no catalog copy. */
  fallback: string | null;
  action: FindingAction;
  /** Faults interrupt (role=alert); warnings are announced politely (role=status). */
  role: "alert" | "status";
};

const SEVERITY_ORDER: Record<ReadinessSeverity, number> = { fault: 0, warn: 1 };

function actionOf(remedy: unknown): FindingAction {
  if (!remedy || typeof remedy !== "object") return { type: "none" };
  const r = remedy as { kind?: unknown; tab?: unknown; vars?: unknown };
  if (r.kind === "door" && typeof r.tab === "string" && isWorkspaceTabId(r.tab)) return { type: "tab", tab: r.tab };
  if (r.kind === "env" && Array.isArray(r.vars)) {
    const vars = r.vars.filter((v): v is string => typeof v === "string" && v.length > 0);
    if (vars.length > 0) return { type: "env", vars };
  }
  return { type: "none" };
}

function paramsOf(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number") out[k] = String(v);
  }
  // A clock that never ticked has no timestamp; the copy branches on `never` (ICU select).
  if ("lastTickAt" in (raw as object) && !out.lastTickAt) out.lastTickAt = "never";
  return out;
}

export function toView(
  findings: readonly unknown[] | undefined | null,
  legacyReasons: readonly string[] | undefined | null,
  knows: (code: string) => boolean
): FindingView[] {
  const rows: FindingView[] = [];
  const covered = new Set<string>();
  for (const [i, raw] of (findings ?? []).entries()) {
    if (!raw || typeof raw !== "object") continue;
    const f = raw as Partial<ReadinessFinding> & { code?: unknown; reason?: unknown };
    if (typeof f.code !== "string") continue;
    const severity: ReadinessSeverity = f.severity === "warn" ? "warn" : "fault";
    const reason = typeof f.reason === "string" ? f.reason : "";
    if (reason) covered.add(reason);
    const known = knows(f.code);
    if (!known && !reason) continue;
    rows.push({
      key: `${f.code}:${i}`,
      code: f.code,
      severity,
      catalogKey: known ? (`findings.${f.code}` as `findings.${ReadinessCode}`) : null,
      params: paramsOf(f.params),
      fallback: known ? null : reason,
      action: known ? actionOf(f.remedy) : { type: "none" },
      role: severity === "fault" ? "alert" : "status",
    });
  }
  for (const [i, reason] of (legacyReasons ?? []).entries()) {
    if (typeof reason !== "string" || !reason || covered.has(reason)) continue;
    rows.push({
      key: `legacy:${i}`,
      code: null,
      severity: "fault",
      catalogKey: null,
      params: {},
      fallback: reason,
      action: { type: "none" },
      role: "alert",
    });
  }
  // Array.prototype.sort is stable, so the server's order survives within a severity.
  return rows.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
