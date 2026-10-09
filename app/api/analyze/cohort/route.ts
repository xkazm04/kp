import { getServerLocale } from "@/i18n/server";
import { isLocale } from "@/i18n/locales";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonOk, jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { meterGate } from "@/app/_lib/billing";
import { listRecentTasks } from "@/app/_lib/db/tasks";
import { startTask } from "@/app/_lib/tasks";
import {
  createAnalysisCohort,
  listAnalysisCohortReuseRows,
  listRecentAnalysisCohorts,
  setAnalysisCohortTask,
} from "@/app/_lib/db/analysis-cohorts";
import {
  sameCv,
  cohortJdContext,
  cohortJdDeps,
  cohortSourceReaders,
  findReusableAnalysis,
  parseCohortRunRequest,
  resolveCohortSources,
  type ResolvedCohortSource,
} from "@/app/_lib/analyze-cohort-proposal";
import {
  assembleAnalysisCohortView,
  cohortViewDeps,
  effectiveCohortStatus,
  summarizeAnalysisCohort,
} from "@/app/_lib/analyze-cohort-view";
import { COHORT_CAP, COHORT_MIN, type CohortRunResponse, type CohortSummary, type MemberSource, type Membership } from "@/app/features/tools/analyze/cohort/cohortTypes";

// Cohort Studio (Analyze v2): GET the recent-cohorts strip, POST to start a comparison.
// The comparison itself runs as an `analyze_cohort` task (analyze-cohort-run.ts) and is
// read through GET /api/analyze/cohort/[id].

/** The strip's length. */
const RECENT_COHORTS = 12;

export async function GET() {
  const denied = await requireCapabilityCoded("read", requireCapability);
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    const deps = cohortViewDeps();
    const jdDeps = cohortJdDeps();
    const out: CohortSummary[] = [];
    for (const rec of listRecentAnalysisCohorts(ws, RECENT_COHORTS)) {
      const ctx = cohortJdContext(rec.jdSlug, ws, jdDeps);
      const status = effectiveCohortStatus(rec.status, rec.taskId ? deps.taskStatus(rec.taskId, ws) : null);
      // The leader is a CLAIM, so it is computed (from the finished comparison) only for a
      // cohort that has one; a deleted JD keeps its slug as the title rather than vanishing.
      const view = ctx && status === "done" ? assembleAnalysisCohortView(rec, ctx, deps) : null;
      out.push(summarizeAnalysisCohort(rec, ctx?.jdTitle ?? rec.jdSlug, status, view));
    }
    return jsonOk(out);
  } catch (error) {
    return safeJsonError(error, "api:analyze/cohort", "COHORT_LOAD_FAILED");
  }
}

// POST CohortRunRequest -> CohortRunResponse. Mirrors /api/analyze: the recruiter seat,
// a per-IP limiter ahead of any spend, the ai_candidates billing gate for the members that
// would be analysed FRESH (a reused analysis spends nothing; an unmetered self-hosted
// install stays unmetered — meterGate answers null there), then the row and the task.
export async function POST(request: Request) {
  const denied = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (denied) return denied;
  // 10/10min per IP: a cohort is up to COHORT_CAP paid analyses plus a comparative pass
  // run twice, so one start is a whole screening session, not a click.
  if (!rateLimit(`analyze-cohort:${clientIpFrom(request.headers)}`, { limit: 10, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const ws = await currentWorkspace();
    const body = parseCohortRunRequest(await request.json().catch(() => null));
    if (!body || body.members.length < COHORT_MIN || body.members.length > COHORT_CAP) {
      return jsonRefusal("COHORT_REQUEST_INVALID", 400, { min: COHORT_MIN, max: COHORT_CAP });
    }
    const ctx = cohortJdContext(body.jdSlug, ws, cohortJdDeps());
    if (!ctx) return jsonRefusal("JD_NOT_FOUND", 404);
    // The report language is read BEFORE the reservation count below: nothing may await
    // between that count and startTask (the gate's race-safety rests on it).
    const reportLang = isLocale(body.reportLang) ? body.reportLang : await getServerLocale();

    // Every member must resolve to a readable CV inside THIS workspace — the same resolver
    // the proposal used, so a member it could not offer cannot be started either.
    const resolved = resolveCohortSources(
      body.members.map((m) => m.memberId),
      ws,
      cohortSourceReaders()
    );
    const members: Array<{ memberId: string; label: string; membership: Membership; source: MemberSource; resolved: ResolvedCohortSource }> = [];
    for (const m of body.members) {
      const r = resolved.get(m.memberId);
      if (!r) return jsonRefusal("COHORT_MEMBER_NOT_FOUND", 400, { memberId: m.memberId });
      // Two ids for the same CV (a profile and its source analysis, or an earlier run of
      // it) would compare a person with themself.
      if (members.some((x) => sameCv(x.resolved, r))) return jsonRefusal("COHORT_REQUEST_INVALID", 400, { min: COHORT_MIN, max: COHORT_CAP });
      members.push({ memberId: m.memberId, label: r.displayLabel, membership: m.membership, source: r.source, resolved: r });
    }
    const reuseRows = listAnalysisCohortReuseRows(body.jdSlug, ws);
    const freshCount = members.filter((m) => findReusableAnalysis(m.resolved, reuseRows) === null).length;

    // Reservation gate. Each queued/running analyze task reserves one unit and each
    // in-flight cohort the fresh units it declared, so N concurrent starts cannot all pass
    // on the same pre-debit balance. No await from here to startTask.
    if (freshCount > 0) {
      const inFlight = listRecentTasks(new Date().toISOString(), 200, ws)
        .filter((t) => t.status === "queued" || t.status === "running")
        .reduce((n, t) => {
          if (t.kind === "analyze") return n + 1;
          if (t.kind !== "analyze_cohort") return n;
          const units = (t.params as { freshCount?: unknown } | null)?.freshCount;
          return n + (typeof units === "number" && units > 0 ? units : 0);
        }, 0);
      const quota = meterGate("ai_candidates", { workspace: ws, minUnits: freshCount, inFlight });
      if (quota) return jsonRefusal("BILLING_QUOTA_EXCEEDED", 402, { meter: quota.meter, plan: quota.plan });
    }

    const rec = createAnalysisCohort(
      {
        jdSlug: body.jdSlug,
        blind: body.blind,
        reportLang,
        members: members.map(({ memberId, label, membership, source }) => ({ memberId, label, membership, source })),
      },
      ws
    );
    // The GitHub deep-dives a technical member's CV link earns ride the SAME
    // github-analysis bucket /api/analyze and /api/github-analysis charge, keyed to the IP
    // that started the run; the runner spends it per deep-dive. A blind run carries none.
    const githubBudgetKey = body.blind ? null : `github-analysis:${clientIpFrom(request.headers)}`;
    const task = startTask("analyze_cohort", { cohortId: rec.id, jdSlug: body.jdSlug, jdTitle: ctx.jdTitle, freshCount, githubBudgetKey }, ws);
    setAnalysisCohortTask(rec.id, task.id, ws);
    const response: CohortRunResponse = { cohortId: rec.id, taskId: task.id };
    return jsonOk(response);
  } catch (error) {
    return safeJsonError(error, "api:analyze/cohort", "COHORT_START_FAILED");
  }
}
