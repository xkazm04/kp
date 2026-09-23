// Deployment readiness, computed ONCE, as coded findings (challenge r03 platform-auth-api/B).
//
// /api/health and /api/ops used to run the same checks in two inline copies (seed loop,
// catalog-seed rule, decision-config loop, scheduler heartbeat), held together only by
// seed-catalog-verdict.test.ts, and the copies had already drifted: only /api/ops checked
// the public origin. Both produced `degradedReasons: string[]`, English sentences the
// System strip printed raw, so a cs/de/fr operator read English and nobody was told what
// to do next.
//
// collectReadiness() is now the one owner. It returns BOTH faces of the same facts:
//
//   * `degradedReasons` / `probeReasons` - the legacy strings, byte-identical to what the
//     routes pushed before, so no monitor, no existing assertion and no `ok` moves.
//     `degradedReasons` is /api/ops's list (origin first, then seeds, catalog, config,
//     clock); `probeReasons` is /api/health's, which never carried the origin check.
//     WHICH findings gate the probe is exactly today's set, and it is NOT severity:
//     a booting clock is a `warn` that has always answered 503 during the first two
//     ticks, and an unset APP_BASE_URL is a `warn` that must not, because onboarding pins
//     `GET /api/health -> 200` as its boot contract and a keyless dev box has no origin.
//   * `findings` - {code, severity, params, remedy, reason}: a closed code the client
//     resolves in the reader's language (models.system.findings.<CODE>), the params that
//     code's copy needs, and the fix - a door into the tab that repairs it, the env vars
//     to set, the host (restart / repair a file), or nothing to do but wait. `reason`
//     rides along as the English floor for a client whose catalog predates a code.
//
// Findings carry workspace ids and absolute seed paths, exactly like the reasons they
// code, so a route releases them only on its home-org detail tier (require-operator.ts).
//
// Every source is injectable (ReadinessSources) so the rules are unit-testable without a
// seed file, a clock or a stored config row; the defaults read the real ones.
import { ensureDb, getSeedHealth, type SeedIssue } from "./db/core";
import { getDecisionConfigHealth, type DecisionConfigIssue } from "./decision-config-store";
import { publicOriginConflict, publicOriginHealth } from "./public-base-url";
import { schedulerLiveness, schedulerLivenessReason, type SchedulerLiveness } from "./scheduler-health";

/** The closed vocabulary (literal array + derived union + guard, the tabs.ts pattern).
 *  Adding a code means a `models.system.findings.<CODE>` title + fix in all four
 *  catalogs (readinessFindings.test.ts checks the bijection). */
export const READINESS_CODES = [
  "PUBLIC_ORIGIN_CONFLICT",
  "PUBLIC_ORIGIN_FALLBACK",
  "SEED_LOAD_FAILED",
  "CATALOG_SEED_FAILED",
  "DECISION_CONFIG_UNREADABLE",
  "SCHEDULER_STARTING",
  "SCHEDULER_STALLED",
] as const;
export type ReadinessCode = (typeof READINESS_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set(READINESS_CODES);
export function isReadinessCode(value: unknown): value is ReadinessCode {
  return typeof value === "string" && CODE_SET.has(value);
}

/** `fault`: something is broken and costs the deployment now. `warn`: worth fixing,
 *  nothing is failing yet (or it will resolve by itself). Rendering only; see the
 *  header for why severity does not decide the probe's status code. */
export type ReadinessSeverity = "fault" | "warn";

/** Where the fix lives. `door` is a workspace tab (validated client-side against
 *  isWorkspaceTabId); `env` names the variables to set; `host` means the fix is on the
 *  server itself (restart the process, repair a file); `none` means wait. */
export type ReadinessRemedy =
  | { kind: "door"; tab: "decisions" }
  | { kind: "env"; vars: string[] }
  | { kind: "host" }
  | { kind: "none" };

export type ReadinessFinding = {
  code: ReadinessCode;
  severity: ReadinessSeverity;
  params: Record<string, string | null>;
  remedy: ReadinessRemedy;
  /** The legacy English diagnostic this finding codes; the client's fallback only. */
  reason: string;
};

export type ReadinessSources = {
  seedIssues: readonly Pick<SeedIssue, "seed" | "path" | "reason" | "severity">[];
  /** Asked only when the jobs seed ERRORED - the one case an empty catalog is a fault. */
  catalogEmpty: () => boolean;
  configIssues: readonly Pick<DecisionConfigIssue, "phase" | "scope" | "workspaceId">[];
  lastTickAt: string | null;
  nowMs: number;
  uptimeMs: number;
};

export type ReadinessReport = {
  findings: ReadinessFinding[];
  /** /api/ops's list: every finding's reason, in order. */
  degradedReasons: string[];
  /** /api/health's list: the same minus the origin findings the probe never gated on. */
  probeReasons: string[];
  seedOk: boolean;
  configOk: boolean;
  clock: SchedulerLiveness;
};

/** The only findings /api/health's verdict does not count (see the header). */
const PROBE_EXEMPT: ReadonlySet<ReadinessCode> = new Set(["PUBLIC_ORIGIN_CONFLICT", "PUBLIC_ORIGIN_FALLBACK"]);

/** One constructor for every finding. Readiness codes are NOT error codes: they never
 *  reach `errors.<CODE>` or useErrorMessage, they resolve under
 *  models.system.findings.<CODE> (readinessFindings.test.ts checks that bijection). */
function finding(
  code: ReadinessCode,
  severity: ReadinessSeverity,
  reason: string,
  extra: { params?: ReadinessFinding["params"]; remedy?: ReadinessRemedy } = {}
): ReadinessFinding {
  return { code, severity, params: extra.params ?? {}, remedy: extra.remedy ?? { kind: "none" }, reason };
}

function readLastTickAt(): string | null {
  const beat = ensureDb()
    .prepare(`SELECT last_tick_at FROM scheduler_heartbeat WHERE id = 'clock'`)
    .get() as { last_tick_at?: string } | undefined;
  return beat?.last_tick_at ?? null;
}

/** The default catalog question: a single `LIMIT 1` existence probe, never a count. */
function jobsCatalogEmpty(): boolean {
  return ensureDb().prepare(`SELECT 1 AS n FROM jobs LIMIT 1 -- tenancy:global`).get() === undefined;
}

/**
 * Run every readiness check once. Throws what the DB throws (a route answers that as
 * `db: "unavailable"`); everything else is data. Sources left out are read for real.
 */
export function collectReadiness(sources: Partial<ReadinessSources> = {}): ReadinessReport {
  const findings: ReadinessFinding[] = [];

  // Origin first - the order /api/ops has always pushed its reasons in.
  const originHealth = publicOriginHealth();
  if (originHealth.reason) {
    const conflict = publicOriginConflict();
    if (conflict) {
      findings.push(
        finding("PUBLIC_ORIGIN_CONFLICT", "fault", originHealth.reason, {
          params: { server: conflict.server, client: conflict.client },
          remedy: { kind: "env", vars: ["APP_BASE_URL", "NEXT_PUBLIC_APP_BASE_URL"] },
        })
      );
    } else {
      // publicOriginHealth only reports a reason for a conflict or a fallback origin.
      findings.push(
        finding("PUBLIC_ORIGIN_FALLBACK", "warn", originHealth.reason, {
          remedy: { kind: "env", vars: ["APP_BASE_URL"] },
        })
      );
    }
  }

  let seedOk = true;
  let seedIssues = sources.seedIssues;
  if (!seedIssues) {
    const seed = getSeedHealth();
    seedOk = seed.ok;
    seedIssues = seed.issues;
  } else {
    seedOk = seedIssues.every((i) => i.severity !== "error");
  }
  for (const issue of seedIssues) {
    if (issue.severity !== "error") continue;
    findings.push(
      finding("SEED_LOAD_FAILED", "fault", `seed:${issue.seed} ${issue.reason} (${issue.path})`, {
        params: { seed: issue.seed, path: issue.path },
        remedy: { kind: "host" },
      })
    );
  }

  // An empty catalog is a fault ONLY when its seed errored (app/api/ops/route.ts has the
  // reasoning); a merely MISSING seed file is a supported install.
  const jobsSeedFailed = seedIssues.some((i) => i.seed === "jobs" && i.severity === "error");
  if (jobsSeedFailed && (sources.catalogEmpty ?? jobsCatalogEmpty)()) {
    findings.push(
      finding("CATALOG_SEED_FAILED", "fault", "job catalog is empty because its seed data failed to load", {
        remedy: { kind: "host" },
      })
    );
  }

  let configOk = true;
  let configIssues = sources.configIssues;
  if (!configIssues) {
    const config = getDecisionConfigHealth();
    configOk = config.ok;
    configIssues = config.issues;
  } else {
    configOk = configIssues.length === 0;
  }
  for (const issue of configIssues) {
    findings.push(
      finding(
        "DECISION_CONFIG_UNREADABLE",
        "fault",
        `decision-config:${issue.phase} unreadable (${issue.scope} ${issue.workspaceId})`,
        {
          params: { phase: issue.phase, scope: issue.scope, workspaceId: issue.workspaceId },
          remedy: { kind: "door", tab: "decisions" },
        }
      )
    );
  }

  const lastTickAt = sources.lastTickAt !== undefined ? sources.lastTickAt : readLastTickAt();
  const clock = schedulerLiveness(
    sources.nowMs ?? Date.now(),
    lastTickAt ? Date.parse(lastTickAt) : null,
    sources.uptimeMs ?? process.uptime() * 1000
  );
  const clockReason = schedulerLivenessReason(clock, lastTickAt);
  if (clockReason) {
    findings.push(
      clock === "starting"
        ? finding("SCHEDULER_STARTING", "warn", clockReason)
        : finding("SCHEDULER_STALLED", "fault", clockReason, { params: { lastTickAt }, remedy: { kind: "host" } })
    );
  }

  const degradedReasons = findings.map((f) => f.reason);
  const probeReasons = findings.filter((f) => !PROBE_EXEMPT.has(f.code)).map((f) => f.reason);
  return { findings, degradedReasons, probeReasons, seedOk, configOk, clock };
}
