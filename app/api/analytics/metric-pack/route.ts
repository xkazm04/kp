import { NextResponse } from "next/server";
import { listJobs, pipelineAnalytics } from "@/app/_lib/db";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { listMembershipsForWorkspace } from "@/app/_lib/db/memberships";
import { candidateNpsSummary } from "@/app/_lib/candidate-nps-store";
import { buildMetricPack, renderMetricPack, type MetricPackInput } from "@/app/_lib/metric-pack";

// W0.4 — the metric pack: the four numbers a buyer asks for, assembled into one
// shareable artifact (app/_lib/metric-pack.ts holds the honesty contract and the
// rendering; this route only supplies real workspace data to it).
//
//   GET /api/analytics/metric-pack            -> JSON
//   GET /api/analytics/metric-pack?format=md  -> the one-page Markdown
//   GET /api/analytics/metric-pack?days=90    -> windowed (default: all time)

const MIN_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 365;

// Who counts as "a recruiter carrying open roles". Owners and admins run the account;
// hiring managers and viewers do not carry a req. Narrow on purpose: inflating the
// denominator would understate capacity, which is the direction that flatters us.
const CARRYING_ROLES = new Set(["owner", "recruiter"]);

function parseWindowDays(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, Math.trunc(n)));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const windowDays = parseWindowDays(searchParams.get("days"));
    const ws = await currentWorkspace();

    const analytics = pipelineAnalytics(windowDays, undefined, ws);

    // Capacity's two terms. A job with a NULL status is a seeded/live corpus row, which
    // is a real open req; only 'draft' (not live) and 'closed' (no longer accepting) are
    // excluded — mirroring the lifecycle contract on JobRecord.status.
    const openRoles = listJobs({}, ws).filter((j) => j.status !== "draft" && j.status !== "closed").length;
    const recruiters = listMembershipsForWorkspace(ws).filter((m) => CARRYING_ROLES.has(m.role)).length;

    const input: MetricPackInput = {
      hired: analytics.hired,
      medianTimeToHireDays: analytics.medianTimeToHireDays,
      avgTimeToHireDays: analytics.avgTimeToHireDays,
      costPerHireCzk: analytics.costPerHireCzk,
      automationRoi: analytics.automationRoi,
      capacity: { openRoles, recruiters },
      candidateNps: (() => {
        const s = candidateNpsSummary(windowDays, ws);
        // rawScore, not score: the pack applies its own thin/measured policy and LABELS a
        // thin metric rather than hiding it, so it needs the unwithheld figure.
        return { score: s.rawScore, responses: s.responses };
      })(),
      windowDays,
    };

    const pack = buildMetricPack(input, new Date().toISOString());

    if (searchParams.get("format") === "md") {
      return new NextResponse(renderMetricPack(pack), {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="kp-metric-pack.md"`,
        },
      });
    }
    return NextResponse.json(pack);
  } catch (error) {
    console.error("[api/analytics/metric-pack] failed to build the metric pack", error);
    const message = error instanceof Error ? error.message : "Failed to build the metric pack.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
