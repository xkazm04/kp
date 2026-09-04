import { NextResponse } from "next/server";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { approveLifecycleCase } from "@/app/_lib/db/devcase";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
// The shared by-id owner guard (sibling module - a route file may export only handlers).
import { ownedLifecycle } from "../../../devcase-owned-lifecycle";
import { isAtReviewGate } from "@/app/_lib/devcase-orchestrator";
import { recordAudit } from "@/app/_lib/dev-control";
import { startTask } from "@/app/_lib/tasks";
import { enforceTaskBudget } from "@/app/_lib/task-budget";
import { clientIpFrom } from "@/app/_lib/rate-limit";
import { enforceProbeGate } from "@/app/_lib/devcase-probe-audit";
import { timeboxClamp, type TimeboxClamp } from "@/app/_lib/devcase-timebox";


// W5-4 — the editable subset of the designed case a reviewer may correct at
// the gate without a regenerate: bounded scalars + the task list. Probes and
// rubric stay engine-owned (change those via "Regenerate with note" so the
// decision-space contract isn't hand-broken).
function coerceCaseEdits(raw: unknown): { edits: Record<string, unknown>; timeboxClamped: TimeboxClamp | null } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const edits: Record<string, unknown> = {};
  if (typeof o.title === "string" && o.title.trim()) edits.title = o.title.trim().slice(0, 200);
  if (typeof o.brief === "string" && o.brief.trim()) edits.brief = o.brief.trim().slice(0, 8000);
  if (Array.isArray(o.tasks)) {
    const tasks = o.tasks
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim().slice(0, 500))
      .slice(0, 20);
    if (tasks.length > 0) edits.tasks = tasks;
  }
  // The timebox is POLICY, not a free scalar: this number renders verbatim to the
  // candidate and caps their unpaid work. The old bound here was `<= 80` — forty times
  // the 2h cap the Python designer enforces — so a reviewer typo at the gate could mint
  // a two-week "take-home" that the generator would never have produced. CLAMP rather
  // than reject (a 10 means "give them longer", and dropping the edit silently is the
  // very failure the 409 branch below was written to fix), against the SHARED bound
  // generated from pipeline/jobfit/devcase/models.py.
  // The rewrite is DESCRIBED, not just performed: `timeboxClamp` is the one producer
  // of { code, from, to }, shared with the review panel, so the reviewer's screen and
  // the audit trail can never disagree about what the candidate will actually receive.
  let timeboxClamped: TimeboxClamp | null = null;
  if (typeof o.timeboxHours === "number") {
    const clamp = timeboxClamp(o.timeboxHours);
    if (clamp) {
      edits.timeboxHours = clamp.to;
      timeboxClamped = clamp;
    } else if (Number.isFinite(o.timeboxHours)) {
      edits.timeboxHours = o.timeboxHours;
    }
  }
  return Object.keys(edits).length > 0 ? { edits, timeboxClamped } : null;
}

// Human gate: approve a lifecycle stuck at awaiting_approval, then resume the
// automated walk. W5-4: the body may carry reviewer edits to the designed case
// ({ case: { title?, brief?, tasks?, timeboxHours? } }) — the gate's promise
// was review/EDIT/approve, not a blind sign-off.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  // Director gate (2026-09-03): the control room's doors carried no operator check, so a
  // demo cookie could reach them. Identity presence for now; the capability slice follows.
  const denied = await requireOperator();
  if (denied) return denied;
  // AUTHORITY (/perfect wave 21, internal-explorers). Signing off an Art. 22 human gate
  // publishes a case to a candidate and resumes the automated walk - a recruiter
  // operation, and emphatically not a viewer's. requireOperator above is identity
  // presence (a no-op in open mode); this is the seat question.
  const forbidden = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (forbidden) return forbidden;
  const { id } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { case?: unknown; overrideProbeAudit?: unknown };
    const coerced = coerceCaseEdits(body.case);
    const edits = coerced?.edits ?? null;
    // OWNERSHIP. A lifecycle id is a globally-unique point-read key, so this route used
    // to approve ANOTHER studio's lifecycle into a live case on a known id. A cross-tenant
    // id now answers the same 404 a nonexistent one does - never an existence oracle.
    const lc = ownedLifecycle(id, await currentWorkspace());
    if (!lc) return NextResponse.json({ error: "lifecycle not found" }, { status: 404 });
    if (isAtReviewGate(lc.stage)) {
      // Persist the dev case + flip to "approved" atomically (the one shared
      // approve transition), then audit the human decision. The audit row lives on
      // a separate connection (dev-control) so it can't join the DB transaction —
      // record it right after. This used to be the dead orchestrator approveLifecycle's
      // only job; the inline copy here omitted it, so human approvals went unaudited.
      const approvedCase = edits ? { ...((lc.case as Record<string, unknown> | null) ?? {}), ...edits } : lc.case;
      // Quality GATE (idea-bb4f5494): a case whose probes can't tell a strong
      // submission from a naive one yields a transfer score that is noise — candidates
      // promoted off it are chosen at random. The probe-strength audit was advisory (a
      // banner) only; ENFORCE it here via the SHARED guard the manual approve path also
      // calls (bug-ui-scan-2026-07-09), so the "none verdict blocks approval unless the
      // reviewer explicitly overrides, and the override is audited" doctrine lives in one
      // place. A "none" verdict returns a 422; the override note goes into the audit trail.
      const probes = (approvedCase as { coverProbes?: unknown[] } | null)?.coverProbes ?? [];
      const gate = enforceProbeGate(probes as Parameters<typeof enforceProbeGate>[0], body.overrideProbeAudit === true);
      if (!gate.ok) {
        return NextResponse.json({ error: gate.error, code: gate.code, verdict: gate.verdict }, { status: gate.status });
      }
      // TASK BUDGET. Approving RESUMES the automated walk below via `startTask`, i.e.
      // this door enqueues the AGENT class directly and POST /api/tasks's per-class
      // budget never saw it. Same helper, same keys (app/_lib/task-budget.ts), so the
      // dock and this gate draw on ONE allowance. Last of the refusals, after the 404,
      // the 409 and the 422 — all cheap — and before the approve transition, so a
      // refused start never leaves a lifecycle approved but not resumed.
      const overBudget = enforceTaskBudget("lifecycle", clientIpFrom(request.headers), lc.workspaceId);
      if (overBudget) return jsonRefusal("TASK_BUDGET_EXHAUSTED", 429, overBudget);
      const { caseId } = approveLifecycleCase(
        id,
        { need: lc.need, analysis: lc.analysis, role: lc.role, case: approvedCase },
        edits ? "approved by a human (with reviewer edits)" : "approved by a human"
      );
      // Surface the clamp to the REVIEWER, in the audit trail they already read for
      // this decision — a silently rewritten number is how the reviewer ends up
      // believing they approved a longer exercise than the candidate receives. The
      // The note is STRUCTURED (`timebox_clamped from=<n> to=<n>`), not English prose:
      // an audit line is queried, and the reviewer reads the clamp in their own language
      // from the review panel's inline notice (devcase.review.timeboxClamped), which
      // renders the same { code, from, to } this line records.
      const reason =
        [
          edits ? `with edits: ${Object.keys(edits).join(", ")}` : null,
          coerced?.timeboxClamped
            ? `${coerced.timeboxClamped.code} from=${coerced.timeboxClamped.from} to=${coerced.timeboxClamped.to}`
            : null,
          gate.auditReason,
        ]
          .filter(Boolean)
          .join("; ") || undefined;
      recordAudit({ lifecycleId: id, actor: "human", action: "approved", ref: caseId, reason, workspaceId: lc.workspaceId });
      // Answer with the clamp too, so a client that skipped the inline notice (an older
      // tab, a script) still learns the approved number is not the number it sent.
      const task = startTask("lifecycle", { lifecycleId: id, title: lc.title }, lc.workspaceId);
      return NextResponse.json({ ok: true, task, timeboxClamped: coerced?.timeboxClamped ?? null });
    }
    // NOT at the review gate — a second tab, a retried fetch, or a reviewer who left
    // the panel open while someone else signed off. The stage is the PRECONDITION for
    // this door and it is re-asserted for EVERY body, not just one carrying edits.
    //
    // It used to be re-asserted only for the edit-carrying path (the reviewer's
    // corrections would otherwise have been silently dropped behind a green
    // { ok: true }). An EDIT-LESS approve fell through to the resume below and started
    // a SECOND "lifecycle" runner on the same case, answering ok both times: the walk
    // is not idempotent — it designs, publishes and dispatches — and startTask's dedup
    // only coalesces runs that are still ACTIVE, so a retry arriving after the first
    // finished ran the whole thing again. There is no honest 200 here: nothing was
    // approved, because there was nothing awaiting approval. Answer 409 with the stage
    // as DATA, so the panel says where the case actually is in the reader's language.
    return jsonRefusal("DEVCASE_LIFECYCLE_NOT_AT_GATE", 409, { stage: lc.stage, editsApplied: false });
  } catch (error) {
    // approveLifecycleCase is a store transaction and the resumed runner spawns Python:
    // the thrown message carries SQLITE_* codes, the db path or child stderr.
    return safeJsonError(error, "api:devcase/lifecycle/approve", "DEVCASE_APPROVE_FAILED");
  }
}
