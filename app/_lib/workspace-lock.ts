// Tenancy is HALF-BUILT. The canonical, machine-checked record of WHICH tables are
// workspace-scoped now lives in `tenancy.ts` (TENANCY_SCOPED_TABLES / EXEMPT +
// `tenancyGaps`) — only the verified-scoped tables there carry + filter on a
// `workspace_id`; the rest (candidate pipeline + PII, events, jobs, interviews,
// decisions, devcase, channels, billing, …) are workspace-blind. The session/switch
// seam is fully built and the UI lets a user create + switch workspaces in two
// clicks — so the moment a 2nd workspace exists, every unscoped table reads/writes
// the FIRST tenant's data (tri-scan 2026-06-18 criticals #1–#4: cross-tenant
// read/write of PII + billing, plus whole-DB export/import).
//
// Fail-safe: until the data layer is fully scoped + tenancy-tested table by table,
// the app is LOCKED to the single default workspace — creation is refused and the
// only switch target is the default. Set KP_MULTI_WORKSPACE=1 to lift the lock, but
// `assertTenancyReady` (db/core.ts, fed from `tenancy.ts`) now REFUSES to boot while
// any per-tenant table is still unscoped, so flipping it early fails loud instead of
// silently re-opening #1–#4.
//
// Pure (no DB import) so the policy is unit-testable and usable from any route.

type EnvLike = Record<string, string | undefined>;

/** True only when the operator has explicitly opted into multi-workspace. Default
 *  (unset/blank/anything else) is the safe single-tenant lock. */
export function multiWorkspaceEnabled(env: EnvLike = process.env): boolean {
  const v = (env.KP_MULTI_WORKSPACE ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** A switch is allowed when multi-workspace is enabled, or the target IS the single
 *  default workspace (a harmless no-op re-mint that cannot cross tenants). */
export function canSwitchWorkspace(targetId: string, defaultId: string, env: EnvLike = process.env): boolean {
  return multiWorkspaceEnabled(env) || targetId === defaultId;
}

/** Whether the public guided demo (`/api/demo`) may mint an anonymous, recruiter-
 *  authorized "demo"-workspace session on a GATED deploy. That session reads the
 *  real tenant's PII through the ~28 still-unscoped tables (the same half-built
 *  tenancy as above), so it is OPT-IN: enable only on a deploy that holds no real
 *  candidate data, or once every table is workspace-scoped. When multi-workspace
 *  is enabled the demo workspace is genuinely isolated, so it is allowed too.
 *  Default (unset) is the safe lock: no anonymous session is minted. */
export function demoSessionAllowed(env: EnvLike = process.env): boolean {
  const v = (env.KP_DEMO_ENABLED ?? "").trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  return multiWorkspaceEnabled(env);
}
