import { NextRequest, NextResponse } from "next/server";
import type { PipelineEntry } from "@/app/_lib/db/core";
import { listPipeline } from "@/app/_lib/db/pipeline";
import { isPassInFlight, runAutomationPass } from "@/app/_lib/automation-pass";
import { decisionsForWorkspace, recordRun } from "@/app/_lib/scheduler-store";
import { affected, describeCommand, isMutating, parseCommand, resolveRejectTargets } from "@/app/_lib/pipeline-command";
import { getPipelineAxis } from "@/app/_lib/pipeline-axis-server";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { executeCommandTargets } from "./execute";


const PREVIEW_CAP = 50;

// `run policy` spawns the deterministic pass — a Python-backed sweep over every
// active entry that dispatches candidate outreach — and it is the ONE command
// here with no per-candidate bound: one line of typing runs the whole board.
// Operator-gated above, but open mode makes that a no-op, so the throttle is the
// real bound (house rule: per-IP rateLimit on every route that spawns a
// subprocess). 6/10min is far above the human pace for a sweep that itself runs
// for minutes, and the sibling POST /api/automation/run is unaffected.
const RUN_POLICY_RATE_LIMIT = { limit: 6, windowMs: 10 * 60_000 };

type PreviewRow = { id: string; label: string; score: number | null; jobTitle: string | null; stage: string };

const toRow = (e: PipelineEntry): PreviewRow => ({
  id: e.id,
  label: e.candidateLabel,
  score: e.matchScore,
  jobTitle: e.jobTitle,
  stage: e.stage,
});

// Recruiter-facing NL command surface (#7). POST {text} previews; POST
// {text, confirm:true} executes. Every mutating intent maps to the SAME guarded
// actions the board/automation already use (actOnPipelineEntry actor:"human",
// runAutomationPass) — the command bar is a parse + preview convenience, not a new
// privilege.
//
// AUTH (perfect-board): operator-gated like /api/decisions/* and screen-wave.
// This is the board's most powerful mutation surface — one call can bulk-reject
// (with candidate emails) across the workspace OR trigger the global policy pass
// (run_policy) — so it re-verifies the operator session as defense in depth:
// proxy.ts already keeps it off the public allow-list, and requireOperator
// additionally rejects the anonymous demo-workspace session the proxy would wave
// through. In open mode (no KP_OPERATOR_PASSWORD) this is a no-op, so local dev
// and the guided sim (which drive the board through the per-card routes, never
// this bar) are unaffected.
export async function POST(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  // AUTHORIZATION (write-routes-check-a-capability). requireOperator above only
  // proves a trusted session is present — in open mode it is true for everyone —
  // so it is identity, never authority. This write is a recruiter operation: ask
  // the seat for `pipeline:write`, so a viewer is refused with a code instead of
  // silently mutating the board.
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  try {
    // Tenant scope: preview AND execute operate ONLY on the caller's workspace.
    const ws = await currentWorkspace();
    // THIS WORKSPACE's board, resolved once. The command bar used to ask its two
    // stage questions by NAME — affected() fell to the shipped axis and the
    // advance loop compared `e.stage === "Offer"` — so a team that composed its own
    // columns got the wrong answer twice: an already-hired candidate on a renamed
    // terminal column was ranked into "advance top N", and a candidate on a renamed
    // offer column was bare-advanced instead of held. Both are role questions.
    const axis = getPipelineAxis(ws).stages;
    const body = (await request.json().catch(() => ({}))) as { text?: string; confirm?: boolean; confirmIds?: unknown };
    const cmd = parseCommand(typeof body.text === "string" ? body.text : "");

    if (cmd.kind === "help" || cmd.kind === "unknown") {
      return NextResponse.json({ kind: cmd.kind, description: describeCommand(cmd) });
    }

    const description = describeCommand(cmd);

    // Preview (no confirm): show what WOULD happen, execute nothing. Resolve the
    // affected set ONCE — the row slice and the total both read it (run_policy has
    // no candidate preview, so its total is null and the scan is skipped).
    if (!body.confirm) {
      const hits = cmd.kind === "run_policy" ? [] : affected(cmd, listPipeline(ws), axis);
      const rows = hits.slice(0, PREVIEW_CAP).map(toRow);
      const total = cmd.kind === "run_policy" ? null : hits.length;
      // matchedIds is the FULL previewed id set — only the RENDERED rows are capped
      // at PREVIEW_CAP, ids are cheap (pipeline-board-candidate-drawer #2). The
      // reject_below confirm binds to this (not the 50 rendered ids), so confirming
      // "reject below N%" on a 120-match cohort rejects all 120 the recruiter was
      // told it "affects", not just the first 50 — while resolveRejectTargets still
      // drops any id that stopped matching between preview and confirm.
      const matchedIds = cmd.kind === "run_policy" ? [] : hits.map((e) => e.id);
      return NextResponse.json({ kind: cmd.kind, description, mutating: isMutating(cmd), preview: rows, total, matchedIds });
    }

    // Execute.
    if (cmd.kind === "run_policy") {
      // run_policy runs the deterministic GLOBAL policy pass — the SAME sweep the
      // scheduler heartbeat runs. It spans teams by design and scopes every WRITE
      // to each entry's own workspace (automation-pass.ts), so it can never mutate
      // one tenant's rows under another's; the operator gate above is what keeps a
      // non-operator (or the demo session) from triggering it at all.
      if (!rateLimit(`pipeline-command-policy:${clientIpFrom(request.headers)}`, RUN_POLICY_RATE_LIMIT)) {
        return jsonRefusal("TOO_MANY_REQUESTS", 429);
      }
      // AUTO2 parity with POST /api/automation/run: a committed pass from the bar is
      // durably recorded like the clock's and the button's, and whoever STARTED the
      // pass records it — a call that joins one in flight records nothing. This must
      // be the last read before runAutomationPass with NO await in between (the
      // single-flight slot is filled synchronously; a suspension in the gap lets two
      // callers both see "nothing in flight" and both log the one executed pass).
      const joined = isPassInFlight();
      const startedAt = new Date().toISOString();
      let result;
      try {
        result = await runAutomationPass();
      } catch (passError) {
        // A STABLE string in the run log, never the thrown text: a scheduler_runs
        // row is rendered back in the automation history, and a pass failure here
        // carries spawn stderr / SQLITE_* detail. The raw cause reaches the server
        // log through the outer safeJsonError.
        if (!joined) recordRun({ status: "error", error: "Automation pass failed.", startedAt, trigger: "manual" });
        throw passError;
      }
      if (!joined) recordRun({ status: "ok", summary: result.summary, decisions: result.decisions, startedAt, trigger: "manual" });
      // TENANCY, same shape as /api/automation/run: the sweep is global by design and
      // the run log keeps the FULL decision list (it is the installation's audit
      // record), but the RESPONSE hands this caller only their own team's rows, so the
      // bar can never paint another tenant's candidate labels. `summary` stays the
      // GLOBAL count of what the pass did and is labelled as such.
      const visible = decisionsForWorkspace(result.decisions, ws) as typeof result.decisions;
      return NextResponse.json({
        kind: cmd.kind,
        executed: true,
        description,
        summary: result.summary,
        summaryScope: "global",
        decisions: visible,
        decisionsWorkspace: ws,
        workspaceDecisionCount: visible.length,
      });
    }

    // The live still-matching set at execute time — same workspace scope as the preview.
    const matching = affected(cmd, listPipeline(ws), axis);
    // bug-ui pipeline #3 — a reject_below confirm binds to the PREVIEWED id set
    // (carried on the confirm POST): execute only on ids that were shown to the
    // recruiter AND still match, so a candidate scored below the line in the gap
    // between preview and confirm can never be silently rejected + emailed. Any
    // previewed id that dropped out (no longer matching) is reported, not acted
    // on. An absent confirmIds (older client) keeps the prior act-on-current-set
    // behavior. advance_top is non-destructive (no email), so it is unbound.
    let droppedOut = 0;
    let targets = matching;
    if (cmd.kind === "reject_below" && Array.isArray(body.confirmIds)) {
      const previewedIds = body.confirmIds.filter((x): x is string => typeof x === "string");
      const { act, droppedOut: dropped } = resolveRejectTargets(previewedIds, matching.map((e) => e.id));
      const actSet = new Set(act);
      targets = matching.filter((e) => actSet.has(e.id));
      droppedOut = dropped.length;
    }
    // Per-target outcome counting lives in ./execute.ts: every target lands in
    // exactly one of count / failed / heldAtOffer, so the bar can never claim a
    // reject it lost to a CAS race or to a throw.
    const { count, failed, commsFailed, heldAtOffer } = await executeCommandTargets(
      { kind: cmd.kind, threshold: cmd.kind === "reject_below" ? cmd.threshold : undefined, targets, axis, workspaceId: ws }
    );
    return NextResponse.json({
      kind: cmd.kind,
      executed: true,
      description,
      count,
      // ALWAYS present, even at zero: a client that renders "failed" only when the
      // field appears must be able to tell "none failed" from "an older server".
      failed,
      commsFailed,
      ...(heldAtOffer ? { heldAtOffer } : {}),
      ...(droppedOut ? { droppedOut } : {}),
    });
  } catch (error) {
    return safeJsonError(error, "api:pipeline:command", "COMMAND_FAILED");
  }
}
