// The deployment-level multi-workspace switch.
//
// HISTORY, because this file's header was the source everything else quoted: the
// lock was introduced when tenancy was half-built (tri-scan 2026-06-18 criticals
// #1–#4 — cross-tenant read/write of PII and billing) and it used to state that
// ~28 tables were still workspace-blind. That is no longer true. The canonical,
// machine-checked record is `tenancy.ts` (TENANCY_SCOPED_TABLES / EXEMPT +
// `tenancyGaps`), every declared table is now classified, and
// `assertTenancyReady` — the boot guard in db/core.ts fed from that manifest —
// passes. Quote the manifest, never this comment.
//
// So the lock is no longer "wait for the data layer". It is an operator's explicit
// opt-in to running more than one tenant in a database, and it stays default-OFF
// for two honest reasons:
//   1. whole-DB export/import is still not per-workspace (`/api/workspace/export`
//      dumps everything; import self-refuses with 503 once this flag is on), and
//   2. billing is per-ORG with no seat enforcement yet.
// Set KP_MULTI_WORKSPACE=1 to turn it on. The boot guard still refuses to start if
// a newly-added table ever regresses the manifest, so flipping it can only fail
// loud, never silently.
//
// Pure (no DB import) so the policy is unit-testable and usable from any route.

type EnvLike = Record<string, string | undefined>;

/** True only when the operator has explicitly opted into multi-workspace. Default
 *  (unset/blank/anything else) is the safe single-tenant lock. Gates workspace
 *  CREATE / RENAME / SWITCH; member administration is org-scoped and unaffected. */
export function multiWorkspaceEnabled(env: EnvLike = process.env): boolean {
  const v = (env.KP_MULTI_WORKSPACE ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Whether public self-serve signup is reachable: the `/signup` page and
 *  POST /api/auth/register. DEFAULT (unset/blank/anything else) is OFF — the
 *  funnel is fully built but GATED, and both surfaces answer 404 as if they
 *  didn't exist. Every registration provisions a brand-new org + team + owner, so
 *  turning it on means accepting strangers as tenants of this deployment: pair it
 *  with KP_MULTI_WORKSPACE (whose boot guard re-proves the tenancy manifest) and
 *  with a billing/abuse answer. A commercial decision, not a build step. */
export function signupEnabled(env: EnvLike = process.env): boolean {
  const v = (env.KP_SIGNUP_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** A switch is allowed when multi-workspace is enabled, or the target IS the single
 *  default workspace (a harmless no-op re-mint that cannot cross tenants). */
export function canSwitchWorkspace(targetId: string, defaultId: string, env: EnvLike = process.env): boolean {
  return multiWorkspaceEnabled(env) || targetId === defaultId;
}

/** Whether the public guided demo (`/api/demo`) may mint an anonymous, recruiter-
 *  authorized "demo"-workspace session on a GATED deploy. It stays OPT-IN because
 *  it hands a stranger a recruiter-capable session: the tables it reads are
 *  workspace-scoped, but the demo workspace is only as empty as the deploy makes
 *  it, and anything NOT scoped by workspace (org-level config, the whole-DB
 *  export) is shared by definition. When multi-workspace is enabled the demo
 *  workspace is a genuine separate tenant, so it is allowed too. Default (unset)
 *  is the safe lock: no anonymous session is minted. */
export function demoSessionAllowed(env: EnvLike = process.env): boolean {
  const v = (env.KP_DEMO_ENABLED ?? "").trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  return multiWorkspaceEnabled(env);
}
