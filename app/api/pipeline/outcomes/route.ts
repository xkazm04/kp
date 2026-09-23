import { NextRequest, NextResponse } from "next/server";
import { jsonRefusal } from "@/app/_lib/api-response";
import { getPipelineEntry } from "@/app/_lib/db/pipeline";
import { getPipelineAxis } from "@/app/_lib/pipeline-axis-server";
import { stageHasRole, stagesWithRole } from "@/app/_lib/pipeline-stages";
import { MIN_CALIBRATION_OUTCOMES } from "@/app/_lib/calibration";
import {
  PERFORMANCE_MAX,
  PERFORMANCE_MIN,
  hireOutcomeRef,
  hirePerformanceSchema,
  latestOutcomeByRefs,
  recordHirePerformance,
} from "@/app/_lib/dev-outcomes";
import { foldHireRatingQueue } from "@/app/_lib/hire-rating-queue";
import { listWorkspaceHires } from "./hire-roster";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";


// UAT KAT-L1-002 (blocker, recurrence 2) — the on-the-job outcome of a HIRE,
// captured from the recruiting workspace.
//
// Why this path, and not an extension of /api/devcase/outcomes: that route is the
// dev-case lane's control-room form (it also carries setFloor and the calibration
// read), and the finding is precisely that the rating was reachable ONLY there.
// This is its recruiting-lane sibling — same noun, same store, filed under the
// resource whose surface writes it, exactly as /api/pipeline/[id] and
// /api/pipeline/events sit beside the board they serve.
//
// AUTH (mirrors the authz-parity contract on /api/pipeline/[id] and its /timeline):
// a performance rating is a judgement about a NAMED PERSON living in the same
// database as sealed decision records, and the GET names candidates' hires by count
// per workspace, so both handlers take the shared operator gate before doing any
// work and every store call is scoped to the caller's workspace. The rating is
// deliberately NOT written as a pipeline event: /api/pipeline/events is the
// unauthenticated Activity feed, and its public projection would carry the rating
// in `detail` (see pipeline-events-public.ts + outcomes-route.test.ts, which pins
// that this route can never reach it). It reaches no candidate-facing projection
// either — the tokenized surfaces expose an explicit field allowlist and none of
// them may learn this field.

/** One hire's rating (`?entry=<id>`), or the workspace's accrual counter and the
 *  queue of hires still awaiting a rating.
 *
 *  `performance: null` means UNRATED and must render as such. There is no default
 *  and no zero: the studio's register is "not yet", never a fabricated value. */
export async function GET(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    // The axis in force for THIS workspace, not the shipped literal: "hired" is the
    // terminal ROLE, so a team that renamed or re-ordered its last column still gets
    // the right answer (pipeline-stages.ts's whole reason for roles).
    const axis = getPipelineAxis(ws).stages;
    const entryId = request.nextUrl.searchParams.get("entry");

    if (entryId) {
      const entry = getPipelineEntry(entryId, ws);
      // Workspace-scoped read: another tenant's id is indistinguishable from a
      // deleted one, which is the point.
      if (!entry) return jsonRefusal("HIRE_RATING_ENTRY_NOT_FOUND", 404);
      const ref = hireOutcomeRef(entry);
      const recorded = latestOutcomeByRefs([ref], ws).get(ref);
      return NextResponse.json({
        entryId: entry.id,
        hired: stageHasRole(entry.stage, "terminal", axis),
        // Only a "hired" row carries a rating (the store's cross-field rule). A row
        // that flipped away from hired reports unrated rather than its stale score.
        performance: recorded?.outcome === "hired" ? recorded.performance : null,
        recordedAt: recorded?.outcome === "hired" && recorded.performance != null ? recorded.recordedAt : null,
        min: PERFORMANCE_MIN,
        max: PERFORMANCE_MAX,
      });
    }

    // The accrual counter Analytics → Quality reads, and (challenge-r07 pipeline-api/B)
    // the unrated hires it lists so the reader can rate them in place. `hires` is the
    // honest denominator — the hires this workspace has actually made — so the surface
    // can distinguish "you have six hires and rated two" from "you have not hired yet".
    // `rated` is folded over THAT roster (hire-rating-queue.ts): a rating on a ref no
    // current hire carries (the dev-case lane, a hire since moved off the terminal
    // column) no longer counts, so rated <= hires by construction. The roster is a
    // projected read, not the hydrated board. `minOutcomes` is the same floor every
    // other calibration gate on that page quotes. Queue rows carry label, role and
    // hire date only: a list of people awaiting a judgement, never of judgements.
    const roster = listWorkspaceHires(ws, stagesWithRole("terminal", axis));
    const queue = foldHireRatingQueue(roster, latestOutcomeByRefs(roster.map((h) => h.ref), ws));
    return NextResponse.json({
      rated: queue.rated,
      hires: queue.hires,
      minOutcomes: MIN_CALIBRATION_OUTCOMES,
      unrated: queue.unrated,
      unratedTotal: queue.unratedTotal,
    });
  } catch (error) {
    return safeJsonError(error, "api:pipeline:outcomes", "PIPELINE_LIST_FAILED");
  }
}

/** Record (or correct) the on-the-job rating of one hire. */
export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  // The SEAT, not just the session (challenge-r07 pipeline-api/A): a rating is a
  // recruiter act on a named hire, so it asks pipeline:write like every other pipeline
  // write door. A viewer may still READ the rating and the Quality counter (the GET
  // stays operator-gated, not capability-gated).
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  try {
    const body = (await request.json().catch(() => ({}))) as unknown;
    const parsed = hirePerformanceSchema.safeParse(body);
    if (!parsed.success) {
      return jsonRefusal("HIRE_RATING_INVALID", 400);
    }
    const ws = await currentWorkspace();
    const entry = getPipelineEntry(parsed.data.entryId, ws);
    if (!entry) return jsonRefusal("HIRE_RATING_ENTRY_NOT_FOUND", 404);
    // A rating is only meaningful for someone who was actually hired — the store's
    // own cross-field rule, enforced here against the LIVE stage rather than trusted
    // from the client, so a stale drawer cannot record an on-the-job outcome for a
    // candidate who never took the job.
    if (!stageHasRole(entry.stage, "terminal", getPipelineAxis(ws).stages)) {
      // UAT i18n gate — a refusal carries a machine code so the drawer can say WHY
      // in the reader's language, instead of leaking canonical English into a
      // Czech board (app/_lib/use-error-message.ts).
      return jsonRefusal("HIRE_RATING_NOT_HIRED", 409);
    }
    const verdict = recordHirePerformance(entry, parsed.data.performance, ws);
    return NextResponse.json({ ok: true, performance: parsed.data.performance, recorded: verdict });
  } catch (error) {
    return safeJsonError(error, "api:pipeline:outcomes", "PIPELINE_ACTION_FAILED");
  }
}
